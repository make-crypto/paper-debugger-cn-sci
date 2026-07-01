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

  function splitModels(value) {
    return value
      .split(/[\n,，;；]+/)
      .map((item) => item.trim())
      .filter(Boolean);
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

      const head = document.createElement("div");
      head.className = "pdm-score-head";
      const labelNode = document.createElement("span");
      labelNode.textContent = label;
      const scoreNode = document.createElement("strong");
      scoreNode.textContent = `${score}/10`;
      head.append(labelNode, scoreNode);

      const bar = document.createElement("div");
      bar.className = "pdm-score-bar";
      bar.setAttribute("aria-label", `${label} ${score}/10`);
      const fill = document.createElement("span");
      fill.style.width = `${score * 10}%`;
      bar.appendChild(fill);

      row.append(head, bar);
      container.appendChild(row);
    });
  }

  function renderTranslations(container, translations, recommendedId) {
    container.innerHTML = "";
    const safeTranslations = Array.isArray(translations) ? translations : [];
    if (!safeTranslations.length) {
      const empty = document.createElement("div");
      empty.className = "pdm-muted";
      empty.textContent = "暂未返回译文候选。";
      container.appendChild(empty);
      return;
    }

    safeTranslations.forEach((translation) => {
      const card = document.createElement("div");
      card.className = "pdm-result-card";
      if (translation.id === recommendedId) {
        card.classList.add("pdm-result-card-recommended");
      }

      const title = document.createElement("div");
      title.className = "pdm-result-title";
      title.textContent = `${translation.label || translation.id} · ${translation.model || "未知模型"}`;
      if (translation.id === recommendedId) {
        const badge = document.createElement("span");
        badge.className = "pdm-badge";
        badge.textContent = "推荐";
        title.appendChild(badge);
      }

      const text = document.createElement("pre");
      text.className = "pdm-sci";
      text.textContent = translation.suggested_latex || "";

      const summary = document.createElement("div");
      summary.className = "pdm-muted";
      summary.textContent = translation.summary || "";

      card.append(title, text, summary);
      container.appendChild(card);
    });
  }

  function renderReviews(container, reviews) {
    container.innerHTML = "";
    const safeReviews = Array.isArray(reviews) ? reviews : [];
    if (!safeReviews.length) {
      const empty = document.createElement("div");
      empty.className = "pdm-muted";
      empty.textContent = "暂未返回评审结果。";
      container.appendChild(empty);
      return;
    }

    safeReviews.forEach((review) => {
      const card = document.createElement("div");
      card.className = "pdm-result-card";

      const title = document.createElement("div");
      title.className = "pdm-result-title";
      title.textContent = `${review.label || review.id} · ${review.model || "未知模型"}`;

      const recommended = document.createElement("div");
      recommended.className = "pdm-muted";
      recommended.textContent = `推荐：${review.recommended_translation_id || "未给出"}`;

      const candidateList = document.createElement("div");
      candidateList.className = "pdm-candidate-scores";
      const candidateScores = Array.isArray(review.candidate_scores) ? review.candidate_scores : [];
      candidateScores.forEach((score) => {
        const item = document.createElement("div");
        item.className = "pdm-candidate-score";
        item.textContent = `${score.candidate_id || "候选"}：清晰度 ${score.clarity ?? 0}/10，学术语气 ${score.academic_tone ?? 0}/10，逻辑 ${score.logic ?? 0}/10，SCI 就绪度 ${score.sci_readiness ?? 0}/10。${score.comment || ""}`;
        candidateList.appendChild(item);
      });

      const summary = document.createElement("div");
      summary.className = "pdm-summary";
      summary.textContent = review.summary || "该评审未返回总结。";

      card.append(title, recommended, candidateList, summary);
      container.appendChild(card);
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
          <div class="pdm-subtitle">多模型 SCI 翻译与评审</div>
        </div>
        <button class="pdm-icon" type="button" data-action="close" title="关闭">x</button>
      </div>
      <div class="pdm-body">
        <section class="pdm-card pdm-config">
          <div class="pdm-section-title">协作模式</div>
          <label class="pdm-field">
            <span>模式</span>
            <select class="pdm-select" data-field="mode">
              <option value="single">单模型总揽</option>
              <option value="dual_translate_review" selected>双译一评</option>
              <option value="custom">自定义多译多评</option>
            </select>
          </label>
          <div class="pdm-route-note">
            当前后端通过 CC Switch 转发；这里填写的是模型名或路由名，实际供应商由 CC Switch 当前 Codex 路由决定。
          </div>
          <label class="pdm-field">
            <span>翻译模型 / 路由名，逗号或换行分隔</span>
            <textarea class="pdm-model-input" data-field="translator-models" spellcheck="false">deepseek-v4-pro, deepseek-v4-flash</textarea>
          </label>
          <label class="pdm-field">
            <span>评审模型 / 路由名，逗号或换行分隔</span>
            <textarea class="pdm-model-input" data-field="reviewer-models" spellcheck="false">deepseek-v4-pro</textarea>
          </label>
          <label class="pdm-field">
            <span>最终汇总模型 / 路由名，可留空</span>
            <input class="pdm-input" data-field="final-model" value="deepseek-v4-pro" />
          </label>
        </section>
        <div class="pdm-actions">
          <button class="pdm-primary" type="button" data-action="translate">运行多模型评审</button>
          <button class="pdm-secondary" type="button" data-action="copy">复制推荐译文</button>
        </div>
        <button class="pdm-link" type="button" data-action="toggle-prompt">提示词设置</button>
        <section class="pdm-prompt" hidden>
          <div class="pdm-section-title">可编辑翻译提示词</div>
          <textarea class="pdm-prompt-input" spellcheck="false"></textarea>
          <div class="pdm-actions">
            <button class="pdm-secondary" type="button" data-action="save-prompt">保存提示词</button>
            <button class="pdm-secondary" type="button" data-action="reset-prompt">恢复默认</button>
          </div>
          <div class="pdm-prompt-status"></div>
        </section>
        <div class="pdm-status">请先在 Overleaf 编辑器中选中中文论文段落，然后点击“运行多模型评审”。</div>
        <section class="pdm-card">
          <div class="pdm-section-title">综合评分</div>
          <div class="pdm-scores"></div>
        </section>
        <section class="pdm-card">
          <div class="pdm-section-title">推荐中英对照</div>
          <div class="pdm-compare">
            <div>
              <div class="pdm-mini-title">原文</div>
              <pre class="pdm-source"></pre>
            </div>
            <div>
              <div class="pdm-mini-title">推荐 SCI 英文</div>
              <pre class="pdm-recommended"></pre>
            </div>
          </div>
        </section>
        <section class="pdm-card">
          <div class="pdm-section-title">译文候选</div>
          <div class="pdm-translations"></div>
        </section>
        <section class="pdm-card">
          <div class="pdm-section-title">评审意见</div>
          <div class="pdm-reviews"></div>
        </section>
        <section class="pdm-card">
          <div class="pdm-section-title">原文问题</div>
          <div class="pdm-issues"></div>
        </section>
        <section class="pdm-card">
          <div class="pdm-section-title">引用与证据判断</div>
          <div class="pdm-citations"></div>
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
    const translationsContainer = panel.querySelector(".pdm-translations");
    const reviewsContainer = panel.querySelector(".pdm-reviews");
    const issuesContainer = panel.querySelector(".pdm-issues");
    const citationsContainer = panel.querySelector(".pdm-citations");
    const sourceContainer = panel.querySelector(".pdm-source");
    const recommendedContainer = panel.querySelector(".pdm-recommended");
    const modeInput = panel.querySelector('[data-field="mode"]');
    const translatorModelsInput = panel.querySelector('[data-field="translator-models"]');
    const reviewerModelsInput = panel.querySelector('[data-field="reviewer-models"]');
    const finalModelInput = panel.querySelector('[data-field="final-model"]');

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
        status.textContent = "还没有可复制的推荐译文。";
        return;
      }
      try {
        await navigator.clipboard.writeText(latestSciEnglish);
        status.textContent = "推荐译文已复制。";
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

      const workflow = {
        mode: modeInput.value,
        translator_models: splitModels(translatorModelsInput.value),
        reviewer_models: splitModels(reviewerModelsInput.value),
        final_model: finalModelInput.value.trim() || null,
        use_final_recommendation: true
      };

      status.textContent = "已读取选中文本，正在运行多模型翻译与评审...";
      latestSciEnglish = "";
      renderScores(scoresContainer, {});
      renderTranslations(translationsContainer, [], "");
      renderReviews(reviewsContainer, []);
      renderList(issuesContainer, [], "正在分析原文问题...");
      renderList(citationsContainer, [], "正在判断引用与证据需求...");
      sourceContainer.textContent = selectedText;
      recommendedContainer.textContent = "正在等待评审推荐译文...";

      try {
        const response = await fetch(`${API_BASE}/debug`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selected_text: selectedText, workflow })
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Backend returned HTTP ${response.status}: ${text}`);
        }

        const data = await response.json();
        latestSciEnglish = data.suggested_latex || selectedText;

        status.textContent = "多模型翻译与评审结果已返回。";
        renderScores(scoresContainer, data.scores || {});
        renderTranslations(translationsContainer, data.translations, data.recommended_translation_id);
        renderReviews(reviewsContainer, data.reviews);
        renderList(issuesContainer, data.issues, "暂未返回原文问题。");
        renderList(citationsContainer, data.citation_assessment, "暂未返回引用判断。");
        sourceContainer.textContent = data.source_text || selectedText;
        recommendedContainer.textContent = latestSciEnglish;
      } catch (error) {
        status.textContent = "本地后端没有返回结果。";
        recommendedContainer.textContent = "";
        renderTranslations(translationsContainer, [
          {
            id: "error",
            label: "错误",
            model: "local backend",
            suggested_latex: [
              "插件已经读取到选中文本，但本地后端没有成功返回多模型结果。",
              "",
              "错误信息：",
              error.message
            ].join("\n")
          }
        ], "");
      }
    });
  }

  document.addEventListener("selectionchange", rememberSelectedText, true);
  document.addEventListener("mouseup", rememberSelectedText, true);
  document.addEventListener("keyup", rememberSelectedText, true);

  createPanel();
})();
