import asyncio

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


async def test_invalid_finding():
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
                    "finding_id": "",
                    "title": "",
                    "severity": "super-high",
                    "url": "ftp://target.example/test",
                    "impact": "",
                },
            )

            for content in result.content:
                if hasattr(content, "text"):
                    print(content.text)


asyncio.run(test_invalid_finding())
