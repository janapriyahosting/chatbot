"""Check the widget as it renders on janapriyaupscale (next on :3000)."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path("/tmp/debug_jpus")
OUT.mkdir(exist_ok=True)


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1400, "height": 900})
        page = await ctx.new_page()

        console = []
        failed_requests: list[str] = []
        page.on("console", lambda m: console.append(f"[{m.type}] {m.text}"))
        page.on("pageerror", lambda e: console.append(f"[PAGEERROR] {e}"))
        page.on("requestfailed", lambda r: failed_requests.append(f"{r.method} {r.url}  ({r.failure})"))

        await page.goto("http://127.0.0.1:3000/", wait_until="networkidle")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=OUT / "01_home.png", full_page=True)

        print("widget launcher count:", await page.locator(".cb-launcher").count())
        print("widget root count:", await page.locator(".cb-root").count())

        # Open the widget
        launcher = page.locator(".cb-launcher")
        if await launcher.count():
            await launcher.click()
            await page.wait_for_timeout(3000)
            await page.screenshot(path=OUT / "02_widget_open.png", full_page=True)

            header_html = await page.locator(".cb-header").first.inner_html() if await page.locator(".cb-header").count() else "<no header>"
            print("HEADER HTML:", header_html[:400])

            body_html = await page.locator(".cb-body").first.inner_html() if await page.locator(".cb-body").count() else "<no body>"
            print("BODY HTML (first 1500):", body_html[:1500])

            # Check the img src in header
            avatar = await page.locator("#cb-header-avatar").get_attribute("src") if await page.locator("#cb-header-avatar").count() else None
            print("avatar src:", avatar)

        print("\n=== FAILED REQUESTS ===")
        for r in failed_requests:
            print(r)

        print("\n=== CONSOLE (last 20) ===")
        for c in console[-20:]:
            print(c)

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
