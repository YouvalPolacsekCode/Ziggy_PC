from integrations.openai_client import get_client


def gpt_reply(prompt: str, model: str = "gpt-4o-mini") -> str:
    try:
        response = get_client().chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f"[OpenAI Error] {e}"