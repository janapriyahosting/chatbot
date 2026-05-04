"""Check the Bots page persona editor to see if the Upload button renders."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8800"
OUT = Path("/tmp/debug_persona")
OUT.mkdir(exist_ok=True)


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1400, "height": 900})
        page = await ctx.new_page()

        page.on("console", lambda m: print(f"[console {m.type}] {m.text}"))
        page.on("pageerror", lambda e: print(f"[PAGEERROR] {e}"))

        await page.goto(f"{BASE}/admin/login")
        await page.fill("input:not([type=password])", "admin@janapriyaupscale.com")
        await page.fill("input[type=password]", "Admin@12345")
        await page.click("button:has-text('Sign in')")
        await page.wait_for_url(f"{BASE}/admin")
        await page.wait_for_selector("text=Bots")
        await page.screenshot(path=OUT / "01_bots_list.png", full_page=True)

        # Click first Persona button
        persona_btn = page.locator("button:has-text('Persona')").first
        cnt = await page.locator("button:has-text('Persona')").count()
        print(f"Persona button count: {cnt}")
        if cnt == 0:
            print("No Persona button found")
            await browser.close(); return
        await persona_btn.click()
        await page.wait_for_timeout(500)
        await page.screenshot(path=OUT / "02_persona_open.png", full_page=True)

        # Check if Upload avatar button exists
        up_cnt = await page.locator("button:has-text('Upload avatar')").count()
        print(f"'Upload avatar' button count: {up_cnt}")

        # Create a tiny test PNG and upload it
        import tempfile, os
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        png = bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108020000"
            "00907753de0000000c49444154789c63f8ffff3f000005fe02fedccc"
            "59e70000000049454e44ae426082"
        )
        tmp.write(png); tmp.close()

        # Set file input on hidden input[type=file] tied to upload button
        file_input = page.locator("input[type=file][accept='image/*']").last
        await file_input.set_input_files(tmp.name)
        await page.wait_for_timeout(2000)

        url_input_val = await page.locator("input[placeholder*='avatar.png']").input_value()
        print(f"URL field after upload: {url_input_val}")
        has_preview = await page.locator("img[src^='/static/uploads/']").count()
        print(f"Preview img count: {has_preview}")

        os.unlink(tmp.name)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
