"""Headless reproduction of the condition `+ rule` button issue.

Drives the admin UI: logs in, opens a flow, adds a condition node, clicks it,
then clicks `+ rule` and observes what happens. Captures console logs and
screenshots at each step so we can see exactly where the breakage is.
"""
import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8800"
OUT = Path("/tmp/debug_condition")
OUT.mkdir(exist_ok=True)


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1400, "height": 900})
        page = await ctx.new_page()

        console_lines: list[str] = []
        page.on("console", lambda msg: console_lines.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: console_lines.append(f"[PAGEERROR] {err}"))

        print("1) login")
        await page.goto(f"{BASE}/admin/login")
        await page.wait_for_selector("input[type=password]")
        await page.fill("input[autofocus], input:not([type=password])", "admin@janapriyaupscale.com")
        await page.fill("input[type=password]", "Admin@12345")
        await page.click("button:has-text('Sign in')")
        await page.wait_for_url(f"{BASE}/admin")

        print("2) find or create a bot")
        await page.wait_for_selector("text=Bots")
        # Find an 'Edit flow' button (first bot with a flow)
        edit = page.locator("button:has-text('Edit flow')").first
        if await edit.count() == 0:
            print("   no existing bot with flow — creating one")
            await page.click("button:has-text('+ New bot')")
            await page.fill("input[placeholder='example.com']", f"dbg-{int(asyncio.get_event_loop().time())}.example.com")
            await page.fill("form input[required]", "Debug Bot")
            await page.click("form button:has-text('Create')")
            await page.wait_for_url("**/flows/**")
        else:
            print("   opening first bot's flow")
            await edit.click()
            await page.wait_for_url("**/flows/**")

        print("3) wait for flow editor")
        await page.wait_for_selector("text=Add node")
        await page.screenshot(path=OUT / "01_editor_loaded.png", full_page=True)

        print("4) click '+ condition' in palette to add a condition node")
        await page.click("button:has-text('+ condition')")
        await page.wait_for_timeout(500)

        print("5) click on the condition node on the canvas")
        # React Flow nodes render text inside .react-flow__node. Search for 'condition' node.
        await page.wait_for_selector(".react-flow__node")
        cond_node = page.locator(".react-flow__node").filter(has_text="condition").first
        await cond_node.click()
        await page.wait_for_timeout(300)
        await page.screenshot(path=OUT / "02_condition_selected.png", full_page=True)

        print("6) count rule cards BEFORE click")
        cards_before = await page.locator(".card label:has-text('Variable')").count()
        print(f"   rule cards before: {cards_before}")

        print("7) click '+ rule'")
        btn_sel = "button:has-text('+ rule')"
        count = await page.locator(btn_sel).count()
        print(f"   '+ rule' button count: {count}")
        btn = page.locator(btn_sel).first
        await btn.click()
        await page.wait_for_timeout(500)
        await page.screenshot(path=OUT / "03_after_click.png", full_page=True)

        print("8) count rule cards AFTER click")
        cards_after = await page.locator(".card label:has-text('Variable')").count()
        print(f"   rule cards after: {cards_after}")
        assert cards_after == cards_before + 1, f"expected {cards_before+1} cards, got {cards_after}"

        print("9) click + rule again; then remove one; verify counts")
        await page.locator("button:has-text('+ rule')").first.click()
        await page.wait_for_timeout(300)
        c2 = await page.locator(".card label:has-text('Variable')").count()
        print(f"   after 2nd + rule: {c2}")
        assert c2 == cards_before + 2

        await page.locator("button:has-text('Remove rule')").first.click()
        await page.wait_for_timeout(300)
        c3 = await page.locator(".card label:has-text('Variable')").count()
        print(f"   after Remove rule: {c3}")
        assert c3 == cards_before + 1
        await page.screenshot(path=OUT / "04_final.png", full_page=True)

        print("\n=== CONSOLE LOG TRANSCRIPT ===")
        for line in console_lines:
            print(line)

        print(f"\nScreenshots in {OUT}")

        await browser.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        raise
