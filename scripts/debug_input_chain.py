"""Walk the full input chain using the new bottom bar."""
import asyncio
from playwright.async_api import async_playwright


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context()
        page = await ctx.new_page()

        await page.goto("http://127.0.0.1:3000/", wait_until="load")
        await page.wait_for_timeout(1500)
        await page.locator(".cb-launcher").click()
        await page.wait_for_timeout(2000)
        await page.locator("button.cb-btn:has-text('Hyderabad')").click()

        async def type_and_send(text: str, step: str):
            print(f"\n-- {step}: typing {text!r} --")
            # Wait up to 5 seconds for bar to become visible
            for _ in range(50):
                if await page.locator(".cb-bar").is_visible():
                    break
                await page.wait_for_timeout(100)
            else:
                raise RuntimeError("bar never showed")
            await page.locator(".cb-bar-input").fill(text)
            print("   placeholder:", await page.locator(".cb-bar-input").get_attribute("placeholder"))
            await page.locator(".cb-bar-send").click()
            await page.wait_for_timeout(2800)  # allow 1.8s typing delay

        await type_and_send("Narendhar", "step 1 name")
        await type_and_send("9876543210", "step 2 phone")
        await type_and_send("n@example.com", "step 3 email")

        body = await page.locator(".cb-body").inner_text()
        print("\nBODY:")
        print(body[-500:])
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
