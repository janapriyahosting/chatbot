"""Simulate: visitor visits janapriyaupscale, widget loads, then visitor closes
and reopens the tab — the widget should still show the full welcome sequence,
not just the awaiting buttons."""
import asyncio
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:3000/"


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # -- First visit: fresh browser ctx, no localStorage yet
        ctx1 = await browser.new_context()
        p1 = await ctx1.new_page()
        await p1.goto(URL, wait_until="load")
        await p1.wait_for_timeout(2000)
        await p1.locator(".cb-launcher").click()
        await p1.wait_for_timeout(2000)
        body1 = await p1.locator(".cb-body").inner_text()
        print("FIRST VISIT body (first 300 chars):")
        print(body1[:300])
        print()

        # Capture the localStorage so we can replay as the "same visitor"
        storage = await ctx1.storage_state()
        await ctx1.close()

        # -- Second visit: new ctx preloaded with that storage (same visitor)
        ctx2 = await browser.new_context(storage_state=storage)
        p2 = await ctx2.new_page()
        await p2.goto(URL, wait_until="load")
        await p2.wait_for_timeout(2000)
        await p2.locator(".cb-launcher").click()
        await p2.wait_for_timeout(2000)
        body2 = await p2.locator(".cb-body").inner_text()
        print("SECOND VISIT (resume) body (first 300 chars):")
        print(body2[:300])
        print()

        # Assertions
        assert "Hello!" in body2, "welcome text missing on resume!"
        assert "Hyderabad" in body2 and "Bangaluru" in body2, "buttons missing on resume!"
        print("OK — resume shows full history including welcome messages")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
