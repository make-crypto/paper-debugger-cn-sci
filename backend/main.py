import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel


load_dotenv()

app = FastAPI(title="Paper Debugger MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://www.overleaf.com", "https://overleaf.com"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DebugRequest(BaseModel):
    selected_text: str


class PromptRequest(BaseModel):
    prompt: str


PROMPT_PATH = Path(__file__).with_name("prompt.txt")


OUTPUT_CONTRACT = """
Required output format:
Return only valid JSON with these fields:
issues: an array of concise Chinese issue explanations,
scores: an object with clarity, academic_tone, logic, sci_readiness, each an integer from 0 to 10,
citation_assessment: an array of concise Chinese notes about which claims need citation or evidence,
suggested_latex: the polished SCI English paragraph, suitable for LaTeX body text,
summary: a concise Chinese summary of the translation and editing strategy.
""".strip()


DEFAULT_SYSTEM_PROMPT = """
You are a senior SCI academic translator and editor.
The user may provide Chinese academic manuscript text, English text, or LaTeX text.

Your task:
1. Understand the academic meaning of the source text, especially when it is Chinese.
2. Identify problems that would weaken SCI-style English writing, such as vague claims,
   colloquial wording, weak logic, overly long sentences, missing transitions, or unclear terminology.
3. Translate and polish the selected text into natural, precise, formal SCI-style English.
4. Preserve the original meaning, factual scope, chronology, names, and technical terms.
5. Do not invent data, sample sizes, model names, locations, citations, metrics, conclusions,
   or experimental results that are not present in the source text.
6. If information is missing, use cautious academic wording instead of fabrication.
7. Judge whether the selected claim likely needs citation support. Do not invent actual citations.
8. Score the selected text and revised SCI English from 0 to 10.
9. Return only valid JSON with these fields:
   issues: an array of concise Chinese issue explanations,
   scores: an object with clarity, academic_tone, logic, sci_readiness, each an integer from 0 to 10,
   citation_assessment: an array of concise Chinese notes about which claims need citation or evidence,
   suggested_latex: the polished SCI English paragraph, suitable for LaTeX body text,
   summary: a concise Chinese summary of the translation and editing strategy.
""".strip()


def get_system_prompt() -> str:
    base_prompt = DEFAULT_SYSTEM_PROMPT
    if PROMPT_PATH.exists():
        saved_prompt = PROMPT_PATH.read_text(encoding="utf-8").strip()
        if saved_prompt:
            base_prompt = saved_prompt
    if "citation_assessment" in base_prompt and "sci_readiness" in base_prompt:
        return base_prompt
    return f"{base_prompt}\n\n{OUTPUT_CONTRACT}"


def extract_response_text(payload: dict) -> str:
    output = payload.get("output") or []
    for item in output:
        if item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if content.get("type") == "output_text" and content.get("text"):
                return content["text"]
    return payload.get("output_text") or ""


def parse_model_json(raw_output: str, selected_text: str) -> dict:
    raw_output = raw_output.strip()
    try:
        return json.loads(raw_output)
    except json.JSONDecodeError:
        start = raw_output.find("{")
        end = raw_output.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(raw_output[start : end + 1])
            except json.JSONDecodeError:
                pass
        return {
            "issues": [
                "The model responded, but its output was not valid JSON.",
            ],
            "scores": {
                "clarity": 0,
                "academic_tone": 0,
                "logic": 0,
                "sci_readiness": 0,
            },
            "citation_assessment": [
                "模型返回内容不是有效 JSON，暂时无法判断引用需求。",
            ],
            "suggested_latex": selected_text,
            "summary": raw_output,
        }


def call_responses_api(selected_text: str, model: str, api_key: str, base_url: str | None) -> str:
    system_prompt = get_system_prompt()
    input_payload = (
        f"{system_prompt}\n\n"
        f"Selected LaTeX text:\n\n{selected_text}"
    )

    if base_url:
        endpoint = f"{base_url.rstrip('/')}/responses"
        try:
            response = httpx.post(
                endpoint,
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "input": input_payload},
                timeout=120,
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
    response = client.responses.create(model=model, input=input_payload)
    return response.output_text.strip()


@app.get("/health")
def health():
    base_url = os.getenv("OPENAI_BASE_URL")
    return {
        "ok": True,
        "model": os.getenv("OPENAI_MODEL", "gpt-4.1"),
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

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return {
            "issues": [
                "The backend is reachable, but OPENAI_API_KEY is not configured yet.",
                "Create a backend/.env file with your OpenAI API key to enable AI analysis.",
            ],
            "scores": {
                "clarity": 0,
                "academic_tone": 0,
                "logic": 0,
                "sci_readiness": 0,
            },
            "citation_assessment": [
                "后端尚未连接模型，暂时无法判断引用需求。",
            ],
            "suggested_latex": selected_text,
            "summary": "Backend connectivity is working. The next step is API key configuration.",
        }

    base_url = os.getenv("OPENAI_BASE_URL")
    model = os.getenv("OPENAI_MODEL", "gpt-4.1")
    raw_output = call_responses_api(selected_text, model, api_key, base_url)
    parsed = parse_model_json(raw_output, selected_text)

    return {
        "source_text": selected_text,
        "issues": parsed.get("issues", []),
        "scores": parsed.get("scores", {}),
        "citation_assessment": parsed.get("citation_assessment", []),
        "suggested_latex": parsed.get("suggested_latex", selected_text),
        "summary": parsed.get("summary", ""),
    }
