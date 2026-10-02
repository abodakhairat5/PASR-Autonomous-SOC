import asyncio
import json

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


async def main():
    async with streamable_http_client(
        "http://127.0.0.1:8765/mcp"
    ) as (read_stream, write_stream):

        async with ClientSession(
            read_stream,
            write_stream
        ) as session:

            await session.initialize()

            result = await session.call_tool(
                "submit_security_finding",
                {
                    "finding_id": "finding-invalid-001",
                    "title": "Invalid Test Finding",
                    "severity": "super-critical",
                    "url": "https://target.example/test",
                    "impact": "This finding must not be stored.",
                },
            )

            for content in result.content:
                if hasattr(content, "text"):
                    print(content.text)


asyncio.run(main())
