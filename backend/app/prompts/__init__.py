import os
from pathlib import Path


PROMPT_DIR = Path(__file__).parent


def load_prompt(step: int) -> str:
    """Load prompt template for a given workflow step."""
    prompt_files = {
        1: "step1_first_impression.md",
        2: "step2_deep_audit.md",
        3: "step3_strategy_blueprint.md",
        4: "step4_reconstruction.md",
        5: "step5_verdict.md"
    }
    
    if step not in prompt_files:
        raise ValueError(f"Invalid step: {step}. Must be one of {list(prompt_files.keys())}")
    
    prompt_path = PROMPT_DIR / prompt_files[step]
    return prompt_path.read_text(encoding="utf-8")


def build_user_message(resume_text: str, job_description: str = None, previous_results: list[str] = None) -> str:
    """Build user message with resume, JD, and previous results."""
    parts = []
    
    parts.append(f"<user_resume>\n{resume_text}\n</user_resume>")
    
    if job_description:
        parts.append(f"<job_description>\n{job_description}\n</job_description>")
    else:
        parts.append("<job_description>\n未提供岗位JD\n</job_description>")
    
    if previous_results:
        results_text = "\n\n".join(previous_results)
        parts.append(f"<pre-process_results>\n{results_text}\n</pre-process_results>")
    
    return "\n\n".join(parts)
