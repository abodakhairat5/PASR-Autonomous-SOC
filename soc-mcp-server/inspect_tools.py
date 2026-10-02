import asyncio

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

            result = await session.list_tools()

            for tool in result.tools:
                print("=" * 60)
                print(f"NAME: {tool.name}")
                print(f"DESCRIPTION: {tool.description}")
                print("INPUT SCHEMA:")
                print(tool.input_schema)


asyncio.run(main())