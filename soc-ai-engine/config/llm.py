import ollama


MODEL_NAME = "qwen2.5:7b"


def get_llm():
    """
    Return the configured Ollama client.

    The project uses the local Ollama model:
    qwen2.5:7b
    """
    return OllamaLLM()


class OllamaLLM:
    """
    Small wrapper around Ollama so all SOC agents
    can use the same LLM interface.
    """

    def invoke(self, prompt: str) -> str:
        response = ollama.chat(
            model=MODEL_NAME,
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            format="json"
        )

        return response["message"]["content"]