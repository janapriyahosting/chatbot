"""Walk the flow on janapriyaupscale, click Hyderabad, then try to type into
the first input field. Observe whether typing works."""
import asyncio
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:3000/"


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context()
        page = await ctx.new_page()
        page.on("console", lambda m: print(f"[{m.type}] {m.text[:200]}"))
        page.on("pageerror", lambda e: print(f"[ERR] {e}"))

        await page.goto(URL, wait_until="load")
        await page.wait_for_timeout(1500)
        await page.locator(".cb-launcher").click()
        await page.wait_for_timeout(2000)

        # Click Hyderabad
        print("click Hyderabad")
        await page.locator("button.cb-btn:has-text('Hyderabad')").click()
        await page.wait_for_timeout(3000)

        body_html = await page.locator(".cb-body").inner_html()
        print("BODY after Hyderabad (last 1200):")
        print(body_html[-1200:])

        # Look for the bottom bar input
        bar_visible = await page.locator(".cb-bar").is_visible()
        bar_input_count = await page.locator(".cb-bar-input").count()
        print(f"\nbottom bar visible: {bar_visible}  bar input count: {bar_input_count}")

        if bar_visible and bar_input_count:
            target = page.locator(".cb-bar-input")
            # Try to focus and type
            await target.click()
            await target.type("Narendhar test", delay=30)
            val = await target.input_value()
            print(f"after typing, input value: {val!r}")

            # Inspect element pointer-events
            pe = await target.evaluate("el => window.getComputedStyle(el).pointerEvents")
            disabled = await target.evaluate("el => el.disabled")
            readonly = await target.evaluate("el => el.readOnly")
            print(f"pointer-events: {pe}  disabled: {disabled}  readOnly: {readonly}")

            # Check parent stack
            parents = await target.evaluate("""el => {
              var path = [];
              while (el && el !== document.body) {
                var s = window.getComputedStyle(el);
                path.push({tag: el.tagName, cls: el.className, pe: s.pointerEvents, pos: s.position, z: s.zIndex});
                el = el.parentElement;
              }
              return path;
            }""")
            for pp in parents[:8]:
                print(" parent:", pp)

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
