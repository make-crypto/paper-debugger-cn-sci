import json
import os
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel, Field


load_dotenv()

app = FastAPI(title="Paper Debugger CN SCI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://www.overleaf.com", "https://overleaf.com"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class WorkflowConfig(BaseModel):
    mode: str = "single"
    translator_models: list[str] = Field(default_factory=list)
    reviewer_models: list[str] = Field(default_factory=list)
    final_model: str | None = None
    use_final_recommendation: bool = True


class DebugRequest(BaseModel):
    selected_text: str
    workflow: WorkflowConfig | None = None


class PromptRequest(BaseModel):
    prompt: str


PROMPT_PATH = Path(__file__).with_name("prompt.txt")


SCORING_RUBRIC = """
Scoring rubric:
0-3 = not usable for an academic paper and needs rewriting.
4-5 = understandable but weak in logic, evidence, or academic expression.
6-7 = usable draft but requires clear revision before SCI submission.
8-9 = close to SCI paper style with only minor human editing needed.
10 = excellent, precise, logically mature, and ready for human final review.
""".strip()


TRANSLATION_CONTRACT = """
Return only valid JSON with these fields:
issues: an array of concise Chinese issue explanations,
citation_assessment: an array of concise Chinese notes about which claims need citation or evidence,
suggested_latex: the polished SCI English paragraph, suitable for LaTeX body text,
summary: a concise Chinese summary of the translation and editing strategy.
""".strip()


REVIEW_CONTRACT = """
Return only valid JSON with these fields:
scores: an object with clarity, academic_tone, logic, sci_readiness, each an integer from 0 to 10,
candidate_scores: an array. Each item must include candidate_id, clarity, academic_tone, logic, sci_readiness, and comment in Chinese,
recommended_translation_id: the candidate_id of the best translation,
issues: an array of concise Chinese issue explanations,
citation_assessment: an array of concise Chinese notes about citation or evidence needs,
summary: a concise Chinese review summary explaining the recommendation.
""".strip()


DEFAULT_SYSTEM_PROMPT = f"""
You are a senior SCI academic translator and editor.
The user may provide Chinese academic manuscript text, English text, or LaTeX text.

Your translation task:
1. Understand the academic meaning of the source text, especially when it is Chinese.
2. Identify problems that would weaken SCI-style English writing, such as vague claims,
   colloquial wording, weak logic, overly long sentences, missing transitions, or unclear terminology.
3. Translate and polish the selected text into natural, precise, formal SCI-style English.
4. Preserve the original meaning, factual scope, chronology, names, and technical terms.
5. Do not invent data, sample sizes, model names, locations, citations, metrics, conclusions,
   or experimental results that are not present in the source text.
6. If information is missing, use cautious academic wording instead of fabrication.
7. Judge whether the selected claim likely needs citation support. Do not invent actual citations.

{TRANSLATION_CONTRACT}
""".strip()


def get_system_prompt() -> str:
    if PROMPT_PATH.exists():
        saved_prompt = PROMPT_PATH.read_text(encoding="utf-8").strip()
        if saved_prompt:
            if "suggested_latex" in saved_prompt:
                return saved_prompt
            return f"{saved_prompt}\n\n{TRANSLATION_CONTRACT}"
    return DEFAULT_SYSTEM_PROMPT


def clean_models(models: list[str]) -> list[str]:
    seen: set[str] = set()
    cleaned: list[str] = []
    for model in models:
        model = model.strip()
        if model and model not in seen:
            seen.add(model)
            cleaned.append(model)
    return cleaned


def get_default_model() -> str:
    return os.getenv("OPENAI_MODEL", "gpt-4.1")


def normalize_workflow(workflow: WorkflowConfig | None) -> WorkflowConfig:
    default_model = get_default_model()
    if workflow is None:
        return WorkflowConfig(
            mode="single",
            translator_models=[default_model],
            reviewer_models=[default_model],
            final_model=default_model,
            use_final_recommendation=True,
        )

    translators = clean_models(workflow.translator_models) or [default_model]
    reviewers = clean_models(workflow.reviewer_models)

    if workflow.mode == "single":
        translators = translators[:1]
        reviewers = reviewers[:1] or translators[:1]
    elif workflow.mode == "dual_translate_review":
        if len(translators) == 1:
            translators = [translators[0], translators[0]]
        else:
            translators = translators[:2]
        reviewers = reviewers[:1] or [workflow.final_model or translators[0]]
    else:
        translators = translators[:4]
        reviewers = (reviewers or [workflow.final_model or default_model])[:4]

    final_model = (workflow.final_model or reviewers[0] if reviewers else translators[0]).strip()

    return WorkflowConfig(
        mode=workflow.mode,
        translator_models=translators,
        reviewer_models=reviewers,
        final_model=final_model,
        use_final_recommendation=workflow.use_final_recommendation,
    )


def extract_response_text(payload: dict[str, Any]) -> str:
    output = payload.get("output") or []
    for item in output:
        if item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if content.get("type") == "output_text" and content.get("text"):
                return content["text"]
    return payload.get("output_text") or ""


def parse_model_json(raw_output: str, fallback: dict[str, Any]) -> dict[str, Any]:
    raw_output = raw_output.strip()
    try:
        parsed = json.loads(raw_output)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        start = raw_output.find("{")
        end = raw_output.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                parsed = json.loads(raw_output[start : end + 1])
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass

    fallback["summary"] = raw_output or fallback.get("summary", "")
    return fallback


def call_model(prompt: str, model: str, api_key: str, base_url: str | None) -> str:
    if base_url:
        endpoint = f"{base_url.rstrip('/')}/responses"
        try:
            response = httpx.post(
                endpoint,
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "input": prompt},
                timeout=180,
                trust_env=False,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Upstream model service returned HTTP {exc.response.status_code}: {exc.response.text}",
            ) from exc
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Could not reach upstream model service: {exc}",
            ) from exc

        return extract_response_text(response.json())

    client = OpenAI(api_key=api_key)
    response = client.responses.create(model=model, input=prompt)
    return response.output_text.strip()


def build_translation_prompt(selected_text: str, translator_index: int, translator_count: int) -> str:
    return (
        f"{get_system_prompt()}\n\n"
        f"You are translator {translator_index} of {translator_count}. "
        "Create an independent SCI-style translation. Do not copy another candidate.\n\n"
        f"Selected LaTeX text:\n\n{selected_text}"
    )


def build_review_prompt(selected_text: str, translations: list[dict[str, Any]]) -> str:
    candidates = json.dumps(
        [
            {
                "candidate_id": item["id"],
                "model": item["model"],
                "suggested_latex": item.get("suggested_latex", ""),
                "translator_summary": item.get("summary", ""),
            }
            for item in translations
        ],
        ensure_ascii=False,
        indent=2,
    )
    return f"""
You are an independent SCI reviewer and academic editor.
Evaluate the candidate translations against the original source text.

Important:
- Do not favor a candidate because of its model name.
- Check semantic fidelity to the Chinese source, academic tone, logical clarity, and SCI readiness.
- Penalize invented details, overclaiming, missing qualifiers, and unsupported claims.
- Judge citation or evidence needs. Do not invent real references.

{SCORING_RUBRIC}

{REVIEW_CONTRACT}

Original source text:
{selected_text}

Candidate translations:
{candidates}
""".strip()


def average_scores(reviews: list[dict[str, Any]]) -> dict[str, int]:
    keys = ["clarity", "academic_tone", "logic", "sci_readiness"]
    totals = {key: 0 for key in keys}
    count = 0
    for review in reviews:
        scores = review.get("scores") or {}
        if not isinstance(scores, dict):
            continue
        count += 1
        for key in keys:
            try:
                totals[key] += int(scores.get(key, 0))
            except (TypeError, ValueError):
                totals[key] += 0
    if not count:
        return {key: 0 for key in keys}
    return {key: round(value / count) for key, value in totals.items()}


def choose_recommended_id(translations: list[dict[str, Any]], reviews: list[dict[str, Any]]) -> str:
    votes: dict[str, int] = {}
    for review in reviews:
        candidate_id = str(review.get("recommended_translation_id") or "").strip()
        if candidate_id:
            votes[candidate_id] = votes.get(candidate_id, 0) + 1
    if votes:
        return sorted(votes.items(), key=lambda item: item[1], reverse=True)[0][0]
    return translations[0]["id"] if translations else "translation-1"


def flatten_unique(items: list[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if isinstance(item, list):
            candidates = item
        else:
            candidates = [item]
        for value in candidates:
            text = str(value).strip()
            if text and text not in seen:
                seen.add(text)
                result.append(text)
    return result


def no_key_response(selected_text: str, workflow: WorkflowConfig) -> dict[str, Any]:
    return {
        "source_text": selected_text,
        "workflow": workflow.model_dump(),
        "translations": [],
        "reviews": [],
        "recommended_translation_id": "",
        "issues": [
            "后端已经启动，但 OPENAI_API_KEY 尚未配置。",
            "请在 backend/.env 中配置 API key 或 CC Switch 路由 key。",
        ],
        "scores": {"clarity": 0, "academic_tone": 0, "logic": 0, "sci_readiness": 0},
        "citation_assessment": ["后端尚未连接模型，暂时无法判断引用需求。"],
        "suggested_latex": selected_text,
        "summary": "后端连通性正常，下一步需要配置模型调用。",
    }


@app.get("/health")
def health():
    base_url = os.getenv("OPENAI_BASE_URL")
    return {
        "ok": True,
        "model": get_default_model(),
        "base_url": base_url or "https://api.openai.com/v1",
        "openai_configured": bool(os.getenv("OPENAI_API_KEY")),
    }


@app.get("/prompt")
def get_prompt():
    return {"prompt": get_system_prompt()}


@app.put("/prompt")
def update_prompt(request: PromptRequest):
    prompt = request.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    PROMPT_PATH.write_text(prompt, encoding="utf-8")
    return {"ok": True, "prompt": prompt}


@app.post("/prompt/reset")
def reset_prompt():
    if PROMPT_PATH.exists():
        PROMPT_PATH.unlink()
    return {"ok": True, "prompt": DEFAULT_SYSTEM_PROMPT}


@app.post("/debug")
def debug_selection(request: DebugRequest):
    selected_text = request.selected_text.strip()
    if not selected_text:
        raise HTTPException(status_code=400, detail="selected_text is required")

    workflow = normalize_workflow(request.workflow)
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return no_key_response(selected_text, workflow)

    base_url = os.getenv("OPENAI_BASE_URL")
    translations: list[dict[str, Any]] = []

    for index, model in enumerate(workflow.translator_models, start=1):
        raw_output = call_model(
            build_translation_prompt(selected_text, index, len(workflow.translator_models)),
            model,
            api_key,
            base_url,
        )
        fallback = {
            "issues": ["翻译模型返回内容不是有效 JSON，已保留原始输出供人工查看。"],
            "citation_assessment": [],
            "suggested_latex": selected_text,
            "summary": raw_output,
        }
        parsed = parse_model_json(raw_output, fallback)
        translations.append(
            {
                "id": f"translation-{index}",
                "label": f"译文 {index}",
                "model": model,
                "issues": parsed.get("issues", []),
                "citation_assessment": parsed.get("citation_assessment", []),
                "suggested_latex": parsed.get("suggested_latex", selected_text),
                "summary": parsed.get("summary", ""),
            }
        )

    reviews: list[dict[str, Any]] = []
    for index, model in enumerate(workflow.reviewer_models, start=1):
        raw_output = call_model(build_review_prompt(selected_text, translations), model, api_key, base_url)
        fallback = {
            "scores": {"clarity": 0, "academic_tone": 0, "logic": 0, "sci_readiness": 0},
            "candidate_scores": [],
            "recommended_translation_id": translations[0]["id"] if translations else "",
            "issues": ["评审模型返回内容不是有效 JSON，暂时无法结构化评分。"],
            "citation_assessment": [],
            "summary": raw_output,
        }
        parsed = parse_model_json(raw_output, fallback)
        reviews.append(
            {
                "id": f"review-{index}",
                "label": f"评审 {index}",
                "model": model,
                "scores": parsed.get("scores", {}),
                "candidate_scores": parsed.get("candidate_scores", []),
                "recommended_translation_id": parsed.get("recommended_translation_id", fallback["recommended_translation_id"]),
                "issues": parsed.get("issues", []),
                "citation_assessment": parsed.get("citation_assessment", []),
                "summary": parsed.get("summary", ""),
            }
        )

    recommended_id = choose_recommended_id(translations, reviews)
    recommended = next((item for item in translations if item["id"] == recommended_id), translations[0])

    all_issues = flatten_unique([item.get("issues", []) for item in translations] + [item.get("issues", []) for item in reviews])
    all_citations = flatten_unique(
        [item.get("citation_assessment", []) for item in translations]
        + [item.get("citation_assessment", []) for item in reviews]
    )

    return {
        "source_text": selected_text,
        "workflow": workflow.model_dump(),
        "translations": translations,
        "reviews": reviews,
        "recommended_translation_id": recommended_id,
        "issues": all_issues,
        "scores": average_scores(reviews),
        "citation_assessment": all_citations,
        "suggested_latex": recommended.get("suggested_latex", selected_text),
        "summary": "已完成多模型翻译与独立评审。" if len(translations) > 1 or len(reviews) > 1 else recommended.get("summary", ""),
    }
