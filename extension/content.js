(function () {
  const PANEL_ID = "paper-translator-mvp-panel";
  const API_BASE = "http://127.0.0.1:8000";

  let latestSciEnglish = "";
  let lastSelectedText = "";

  function readCurrentSelectedText() {
    const browserSelection = window.getSelection();
    const selected = browserSelection ? browserSelection.toString().trim() : "";
    if (selected) {
      return selected;
    }

    const activeElement = document.activeElement;
    if (
      activeElement &&
      typeof activeElement.value === "string" &&
      typeof activeElement.selectionStart === "number" &&
      typeof activeElement.selectionEnd === "number"
    ) {
      return activeElement.value
        .slice(activeElement.selectionStart, activeElement.selectionEnd)
        .trim();
    }

    return "";
  }

  function rememberSelectedText() {
    const selectedText = readCurrentSelectedText();
    if (selectedText) {
      lastSelectedText = selectedText;
    }
  }

  function getSelectedText() {
    const selectedText = readCurrentSelectedText();
    if (selectedText) {
      lastSelectedText = selectedText;
      return selectedText;
    }

    return lastSelectedText;
  }

  function renderList(container, items, emptyText) {
    container.innerHTML = "";
    const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!safeItems.length) {
      const empty = document.createElement("div");
      empty.className = "pdm-muted";
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }

    const list = document.createElement("ol");
    safeItems.forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      list.appendChild(item);
    });
    container.appendChild(list);
  }

  function normalizeScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return Math.max(0, Math.min(10, Math.round(number)));
  }

  function renderScores(container, scores) {
    const items = [
      ["清晰度", scores && scores.clarity],
      ["学术语气", scores && scores.academic_tone],
      ["逻辑连贯", scores && scores.logic],
      ["SCI 就绪度", scores && scores.sci_readiness]
    ];

    container.innerHTML = "";
    items.forEach(([label, rawScore]) => {
      const score = normalizeScore(rawScore);
      const row = document.createElement("div");
      row.className = "pdm-score-row";
      row.innerHTML = `
        <div class="pdm-score-head">
          <span>${label}</span>
          <strong>${score}/10</strong>
        </div>
        <div class="pdm-score-bar" aria-label="${label} ${score}/10">
          <span style="width: ${score * 10}%"></span>
        </div>
      `;
      container.appendChild(row);
    });
  }

  async function loadPrompt(textarea, status) {
    status.textContent = "正在读取提示词...";
    const response = await fetch(`${API_BASE}/prompt`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    textarea.value = data.prompt || "";
    status.textContent = "提示词已读取。";
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) {
      return;
    }

    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="pdm-header">
        <div>
          <div class="pdm-title">论文翻译助手</div>
          <div class="pdm-subtitle">中文论文转 SCI 英文</div>
        </div>
        <button class="pdm-icon" type="button" data-action="close" title="关闭">x</button>
      </div>
      <div class="pdm-body">
        <div class="pdm-actions">
          <button class="pdm-primary" type="button" data-action="translate">翻译并评判</button>
          <button class="pdm-secondary" type="button" data-action="copy">复制 SCI 英文</button>
        </div>
        <button class="pdm-link" type="button" data-action="toggle-prompt">提示词设置</button>
        <section class="pdm-prompt" hidden>
          <div class="pdm-section-title">可编辑提示词</div>
          <textarea class="pdm-prompt-input" spellcheck="false"></textarea>
          <div class="pdm-actions">
            <button class="pdm-secondary" type="button" data-action="save-prompt">保存提示词</button>
            <button class="pdm-secondary" type="button" data-action="reset-prompt">恢复默认</button>
          </div>
          <div class="pdm-prompt-status"></div>
        </section>
        <div class="pdm-status">请先在 Overleaf 编辑器中选中中文论文段落，然后点击“翻译并评判”。</div>
        <section class="pdm-card">
          <div class="pdm-section-title">质量评分</div>
          <div class="pdm-scores"></div>
        </section>
        <section class="pdm-card">
          <div class="pdm-section-title">原文问题</div>
          <div class="pdm-issues"></div>
        </section>
        <section class="pdm-card">
          <div class="pdm-section-title">引用与证据判断</div>
          <div class="pdm-citations"></div>
        </section>
        <section class="pdm-card">
          <div class="pdm-section-title">中英对照</div>
          <div class="pdm-compare">
            <div>
              <div class="pdm-mini-title">原文</div>
              <pre class="pdm-source"></pre>
            </div>
            <div>
              <div class="pdm-mini-title">SCI 英文</div>
              <pre class="pdm-sci"></pre>
            </div>
          </div>
        </section>
        <section class="pdm-card">
          <div class="pdm-section-title">修改说明</div>
          <div class="pdm-summary"></div>
        </section>
      </div>
    `;

    document.documentElement.appendChild(panel);

    const closeButton = panel.querySelector('[data-action="close"]');
    const translateButton = panel.querySelector('[data-action="translate"]');
    const copyButton = panel.querySelector('[data-action="copy"]');
    const promptToggle = panel.querySelector('[data-action="toggle-prompt"]');
    const savePromptButton = panel.querySelector('[data-action="save-prompt"]');
    const resetPromptButton = panel.querySelector('[data-action="reset-prompt"]');
    const promptPanel = panel.querySelector(".pdm-prompt");
    const promptTextarea = panel.querySelector(".pdm-prompt-input");
    const promptStatus = panel.querySelector(".pdm-prompt-status");
    const status = panel.querySelector(".pdm-status");
    const scoresContainer = panel.querySelector(".pdm-scores");
    const issuesContainer = panel.querySelector(".pdm-issues");
    const citationsContainer = panel.querySelector(".pdm-citations");
    const sourceContainer = panel.querySelector(".pdm-source");
    const sciContainer = panel.querySelector(".pdm-sci");
    const summaryContainer = panel.querySelector(".pdm-summary");

    closeButton.addEventListener("click", () => {
      panel.remove();
    });

    promptToggle.addEventListener("click", async () => {
      promptPanel.hidden = !promptPanel.hidden;
      if (!promptPanel.hidden && !promptTextarea.value) {
        try {
          await loadPrompt(promptTextarea, promptStatus);
        } catch (error) {
          promptStatus.textContent = `提示词读取失败：${error.message}`;
        }
      }
    });

    savePromptButton.addEventListener("click", async () => {
      promptStatus.textContent = "正在保存提示词...";
      try {
        const response = await fetch(`${API_BASE}/prompt`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: promptTextarea.value })
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        promptStatus.textContent = "提示词已保存，下一次翻译会使用新提示词。";
      } catch (error) {
        promptStatus.textContent = `提示词保存失败：${error.message}`;
      }
    });

    resetPromptButton.addEventListener("click", async () => {
      promptStatus.textContent = "正在恢复默认提示词...";
      try {
        const response = await fetch(`${API_BASE}/prompt/reset`, { method: "POST" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        promptTextarea.value = data.prompt || "";
        promptStatus.textContent = "提示词已恢复默认。";
      } catch (error) {
        promptStatus.textContent = `恢复默认失败：${error.message}`;
      }
    });

    copyButton.addEventListener("click", async () => {
      if (!latestSciEnglish) {
        status.textContent = "还没有可复制的 SCI 英文结果。";
        return;
      }
      try {
        await navigator.clipboard.writeText(latestSciEnglish);
        status.textContent = "SCI 英文译文已复制。";
      } catch (error) {
        status.textContent = `复制失败：${error.message}`;
      }
    });

    translateButton.addEventListener("click", async () => {
      rememberSelectedText();
      const selectedText = getSelectedText();
      if (!selectedText) {
        status.textContent = "没有读取到选中文本。请在 Overleaf 编辑器里重新拖选一段文字后再点击。";
        return;
      }

      status.textContent = "已读取选中文本，正在翻译、评分并判断引用需求...";
      latestSciEnglish = "";
      renderScores(scoresContainer, {});
      renderList(issuesContainer, [], "正在分析原文问题...");
      renderList(citationsContainer, [], "正在判断引用与证据需求...");
      sourceContainer.textContent = selectedText;
      sciContainer.textContent = "正在生成 SCI 英文译文...";
      summaryContainer.textContent = "";

      try {
        const response = await fetch(`${API_BASE}/debug`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selected_text: selectedText })
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Backend returned HTTP ${response.status}: ${text}`);
        }

        const data = await response.json();
        latestSciEnglish = data.suggested_latex || selectedText;

        status.textContent = "翻译和评判结果已返回。";
        renderScores(scoresContainer, data.scores || {});
        renderList(issuesContainer, data.issues, "暂未返回原文问题。");
        renderList(citationsContainer, data.citation_assessment, "暂未返回引用判断。");
        sourceContainer.textContent = data.source_text || selectedText;
        sciContainer.textContent = latestSciEnglish;
        summaryContainer.textContent = data.summary || "暂未返回修改说明。";
      } catch (error) {
        status.textContent = "本地后端没有返回结果。";
        sciContainer.textContent = [
          "插件已经读取到选中文本，但本地后端没有成功返回翻译和评判。",
          "",
          "错误信息：",
          error.message
        ].join("\n");
      }
    });
  }

  document.addEventListener("selectionchange", rememberSelectedText, true);
  document.addEventListener("mouseup", rememberSelectedText, true);
  document.addEventListener("keyup", rememberSelectedText, true);

  createPanel();
})();
