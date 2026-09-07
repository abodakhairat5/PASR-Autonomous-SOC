import asyncio
import json

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


MCP_URL = "http://127.0.0.1:8765/mcp"


async def main():

    print(f"Connecting to {MCP_URL}...")

    async with streamable_http_client(MCP_URL) as (
        read_stream,
        write_stream,
    ):

        async with ClientSession(
            read_stream,
            write_stream,
        ) as session:

            # -------------------------------------------------
            # Initialize MCP session
            # -------------------------------------------------

            await session.initialize()

            print("Connected successfully.")
            print()

            # -------------------------------------------------
            # List available tools
            # -------------------------------------------------

            tools = await session.list_tools()

            print("Available tools:")

            for tool in tools.tools:
                print(f"- {tool.name}")

            print()

            # -------------------------------------------------
            # Test 1: health_check
            # -------------------------------------------------

            print("Calling health_check...")
            print()

            result = await session.call_tool(
                "health_check",
                {},
            )

            print("health_check result:")
            print(result)
            print()

            # -------------------------------------------------
            # Test 2: submit_security_finding
            # -------------------------------------------------

            print("Calling submit_security_finding...")
            print()

            finding = {
                "finding_id": "finding-test-001",
                "title": "SQL Injection",
                "severity": "high",
                "url": "https://target.example/api/users",
                "impact": "Attacker can access unauthorized data",
            }

            result = await session.call_tool(
                "submit_security_finding",
                finding,
            )

            print("submit_security_finding result:")

            for content in result.content:
                if hasattr(content, "text"):
                    try:
                        parsed = json.loads(content.text)
                        print(
                            json.dumps(
                                parsed,
                                indent=2,
                                ensure_ascii=False,
                            )
                        )
                    except Exception:
                        print(content.text)
                else:
                    print(content)

            print()

            # -------------------------------------------------
            # Test 3: get_security_finding
            # -------------------------------------------------

            print("Calling get_security_finding...")
            print()

            result = await session.call_tool(
                "get_security_finding",
                {
                    "finding_id": "finding-test-001",
                },
            )

            print("get_security_finding result:")

            for content in result.content:
                if hasattr(content, "text"):
                    try:
                        parsed = json.loads(content.text)
                        print(
                            json.dumps(
                                parsed,
                                indent=2,
                                ensure_ascii=False,
                            )
                        )
                    except Exception:
                        print(content.text)
                else:
                    print(content)

            print()

            # -------------------------------------------------
            # Test 4: list_security_findings
            # -------------------------------------------------

            print("Calling list_security_findings...")
            print()

            result = await session.call_tool(
                "list_security_findings",
                {
                    "limit": 10,
                },
            )

            print("list_security_findings result:")

            for content in result.content:
                if hasattr(content, "text"):
                    try:
                        parsed = json.loads(content.text)
                        print(
                            json.dumps(
                                parsed,
                                indent=2,
                                ensure_ascii=False,
                            )
                        )
                    except Exception:
                        print(content.text)
                else:
                    print(content)

            print()

            print("All MCP tests completed.")


if __name__ == "__main__":
    asyncio.run(main())