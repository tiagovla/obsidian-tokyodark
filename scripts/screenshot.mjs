import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const root = fileURLToPath(new URL("..", import.meta.url));
const base = fs.readFileSync(`${root}/src/app-css/app-1.13.4.css`, "utf8");
const theme = fs.readFileSync(`${root}/theme.css`, "utf8");
const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`));
const pkg = JSON.parse(fs.readFileSync(`${root}/package.json`));
const versions = JSON.parse(fs.readFileSync(`${root}/versions.json`));
assert.equal(manifest.name, "TokyoDark");
assert.equal(manifest.version, pkg.version);
assert.equal(versions[pkg.version], manifest.minAppVersion);
const variables = [...theme.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
assert.equal(variables.length, new Set(variables).size, "No duplicate tokens");
const html = fs.readFileSync(new URL("preview.html", import.meta.url), "utf8");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 810 },
      deviceScaleFactor: 1,
    });
    await page.route("**/*", (route) => route.abort());
    await page.setContent(html);
    await page.addStyleTag({ content: base });
    await page.$eval("#preview-layout", (style) => document.head.append(style));
    const properties = [
      "color",
      "backgroundColor",
      "borderColor",
      "outlineColor",
      "fontFamily",
    ];
    const snapshot = () =>
      page.evaluate(
        (properties) =>
          Object.fromEntries(
            [
              "body",
              "h1",
              "h2",
              ".tag",
              ".token.keyword",
              ".python-code .cm-def",
              ".non-code-definition",
              "button",
              "#search",
            ].map((s) => [
              s,
              Object.fromEntries(
                properties.map((p) => [
                  p,
                  getComputedStyle(document.querySelector(s))[p],
                ]),
              ),
            ]),
          ),
        properties,
      );
    await page.evaluate(
      () => (document.body.className = "theme-light mod-linux"),
    );
    const lightBefore = await snapshot();
    await page.addStyleTag({ content: theme });
    assert.deepEqual(await snapshot(), lightBefore, "Light mode unchanged");
    await page.evaluate(
      () => (document.body.className = "theme-dark mod-linux"),
    );
    const color = (selector, property = "color") =>
      page.$eval(selector, (e, p) => getComputedStyle(e)[p], property);
    assert.equal(await color("body", "backgroundColor"), "rgb(17, 18, 29)");
    assert.equal(await color("body"), "rgb(160, 168, 205)");
    assert.equal(await color("h1"), "rgb(238, 109, 133)");
    assert.equal(await color("h2"), "rgb(215, 166, 95)");
    assert.equal(await color("h3"), "rgb(149, 197, 97)");
    assert.equal(await color("h4"), "rgb(56, 168, 157)");
    assert.equal(await color("h5"), "rgb(113, 153, 238)");
    assert.equal(await color("h6"), "rgb(164, 133, 221)");
    assert.equal(await color(".HyperMD-header-1"), await color("h1"));
    assert.equal(await color(".cm-keyword"), await color(".token.keyword"));
    assert.equal(await color(".cm-string"), await color(".token.string"));
    assert.equal(
      await color(".python-code .cm-def"),
      "rgb(149, 197, 97)",
      "Python function definitions use the function color",
    );
    assert.equal(
      await color(".python-code .cm-variable"),
      await color("body"),
      "Python variables keep their normal color",
    );
    assert.equal(
      await color(".non-code-definition"),
      await color("body"),
      "Definition styling stays inside fenced code",
    );
    assert.equal(
      await page.$eval('.callout[data-callout="tip"]', (e) =>
        getComputedStyle(e).getPropertyValue("--callout-color").trim(),
      ),
      "#38a89d",
    );
    const unresolved = await page.evaluate(
      (variables) =>
        variables.filter(
          (v) => !getComputedStyle(document.body).getPropertyValue(v).trim(),
        ),
      variables,
    );
    assert.deepEqual(unresolved, [], "All theme tokens resolve");
    const unknown = variables.filter((v) => !base.includes(v));
    assert.deepEqual(unknown, [], "Theme uses native tokens");
    for (const [fg, bg] of [
      ["#a0a8cd", "#11121d"],
      ["#9099ba", "#0d0e17"],
      ["#747d9a", "#11121d"],
      ["#11121d", "#a485dd"],
      ["#11121d", "#95c561"],
    ]) {
      const luminance = (hex) => {
        const channels = hex
          .match(/[a-f\d]{2}/gi)
          .map((c) => parseInt(c, 16) / 255)
          .map((c) =>
            c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
          );
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        );
      };
      const [a, b] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      const contrast = (a + 0.05) / (b + 0.05);
      assert.ok(contrast >= 4.5, `${fg} on ${bg}: ${contrast}`);
    }
    await page.screenshot({ path: `${root}/screenshots/screenshot.png` });
    await page.hover(".internal-link");
    assert.equal(await color(".internal-link"), "rgb(159, 187, 243)");
    await page.focus("#search");
    assert.notEqual(
      await color("#search", "boxShadow"),
      "none",
      "Keyboard focus stays visible",
    );
    const defaultAccent = await color("button", "backgroundColor");
    await page.evaluate(() =>
      document.body.style.setProperty("--accent-h", "180"),
    );
    assert.notEqual(
      await color("button", "backgroundColor"),
      defaultAccent,
      "Custom accent works",
    );
    await page.evaluate(() => document.body.style.removeProperty("--accent-h"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.body.classList.add("is-mobile"));
    assert.equal(
      await color("body", "backgroundColor"),
      "rgb(17, 18, 29)",
      "Mobile keeps theme background",
    );
    assert.equal(
      await color(".python-code .cm-def"),
      "rgb(149, 197, 97)",
      "Mobile Python function definitions use the function color",
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Mobile has no horizontal overflow",
    );
    await page.screenshot({
      path: `${root}/screenshots/screenshot-mobile.png`,
    });
    console.log(
      `PASS: metadata, ${variables.length} tokens, dark palette, light fallback, reading/editor syntax, contrast, hover, focus, custom accent, mobile width.`,
    );
    console.log(
      "Saved screenshots/screenshot.png and screenshots/screenshot-mobile.png",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
