import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, Page, Route } from "@playwright/test";

interface IFeedTestState {
  rejectNext: boolean;
  deferNext: boolean;
  rejectDeferred?: () => void;
  playCalls: number;
  playsInGesture: boolean[];
}

interface IClipMutation {
  operationName: string;
  variables: {
    id?: string;
    input?: { rating100?: number };
    resume_time?: number;
    playDuration?: number;
  };
}

declare global {
  interface Window {
    __feedTest: IFeedTestState;
  }
}

let fixtureDirectory: string;
let video: Buffer;
const browserProblems = new WeakMap<Page, string[]>();

function serveVideo(route: Route, body: Buffer) {
  const range = /^bytes=(\d+)-(\d*)$/.exec(
    route.request().headers().range ?? ""
  );
  if (!range) {
    return route.fulfill({ contentType: "video/mp4", body });
  }
  const start = Number(range[1]);
  const end = Math.min(
    range[2] ? Number(range[2]) : body.length - 1,
    body.length - 1
  );
  return route.fulfill({
    status: 206,
    contentType: "video/mp4",
    headers: {
      "accept-ranges": "bytes",
      "content-range": `bytes ${start}-${end}/${body.length}`,
    },
    body: body.subarray(start, end + 1),
  });
}

async function preparePlayback(
  page: Page,
  options = { muted: true, clean: false, rejectNext: false, deferNext: false }
) {
  await page.addInitScript((settings) => {
    localStorage.setItem("clip-feed-muted", settings.muted ? "1" : "0");
    localStorage.setItem("clip-feed-clean", settings.clean ? "1" : "0");
    window.__feedTest = {
      rejectNext: settings.rejectNext,
      deferNext: settings.deferNext,
      playCalls: 0,
      playsInGesture: [],
    };
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function play() {
      const state = window.__feedTest;
      state.playCalls++;
      state.playsInGesture.push(
        (navigator as Navigator & { userActivation: { isActive: boolean } })
          .userActivation.isActive
      );
      if (state.rejectNext) {
        state.rejectNext = false;
        return Promise.reject(
          new DOMException("Test blocked playback", "NotAllowedError")
        );
      }
      if (state.deferNext) {
        state.deferNext = false;
        return new Promise<void>((resolve, reject) => {
          state.rejectDeferred = () =>
            reject(new DOMException("Test stale rejection", "NotAllowedError"));
        });
      }
      return nativePlay.call(this);
    };
  }, options);
}

async function goToClip(page: Page, index: number) {
  await page.locator(".clip-feed__scroller").evaluate((element, target) => {
    element.scrollTo({ top: target * element.clientHeight });
  }, index);
  const player = page.locator(".clip-feed__video");
  await expect(player).toHaveAttribute("data-clip-id", String(index + 1));
  await expect
    .poll(
      () =>
        player.evaluate(
          (el: HTMLVideoElement, target) => ({
            currentSource: el.currentSrc.endsWith(`/clip-${target}.mp4`),
            advancing: !el.paused && el.currentTime > 0.05,
          }),
          index + 1
        ),
      { intervals: [50, 100] }
    )
    .toEqual({ currentSource: true, advancing: true });
}

async function startWithSound(page: Page) {
  await preparePlayback(page);
  await page.goto("/clips/feed");
  await expect(page.locator(".clip-feed__video")).toHaveJSProperty(
    "paused",
    false
  );
  await page.locator('.clip-feed__topbar button[title="Unmute"]').click();
  await expect(page.locator(".clip-feed__video")).toHaveJSProperty(
    "muted",
    false
  );
  await expect(page.locator(".clip-feed__buffering")).toHaveCount(0);
}

test.beforeAll(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "stash-clip-feed-"));
  const path = join(fixtureDirectory, "tone.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=180x320:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    path,
  ]);
  video = readFileSync(path);
});

test.afterAll(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

test.beforeEach(async ({ page, baseURL }) => {
  const problems: string[] = [];
  browserProblems.set(page, problems);
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(message.text());
    }
  });
  await page.route("**/__feed_test__/**", (route) => {
    if (route.request().url().endsWith(".mp4")) {
      return serveVideo(route, video);
    }
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="320"><rect width="180" height="320" fill="#173245"/></svg>',
    });
  });

  await page.route("**/graphql", async (route) => {
    const { operationName, variables } = route.request().postDataJSON();
    const makeClip = (id: number) => ({
      __typename: "Clip",
      id: String(id),
      title: `Test clip ${id}`,
      details: null,
      date: null,
      rating100: 70,
      organized: false,
      start_seconds: 0,
      end_seconds: 3,
      o_counter: 0,
      play_count: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      scene: { __typename: "Scene", id: "1", title: "Test scene", date: null },
      paths: {
        __typename: "ClipPathsType",
        stream: new URL(`/__feed_test__/clip-${id}.mp4`, baseURL).href,
        preview: null,
        screenshot: new URL("/__feed_test__/poster.svg", baseURL).href,
      },
      studio: null,
      tags: [],
      performers: [],
    });

    let data;
    if (operationName === "Configuration") {
      const response = await route.fetch();
      const json = await response.json();
      json.data.configuration.ui.ratingSystemOptions = { type: "decimal" };
      await route.fulfill({ response, json });
      return;
    } else if (operationName === "FindClips") {
      const start = ((variables.filter?.page ?? 1) - 1) * 40;
      data = {
        findClips: {
          __typename: "FindClipsResultType",
          count: 120,
          clips: Array.from({ length: 40 }, (_, i) => makeClip(start + i + 1)),
        },
      };
    } else if (operationName === "ClipSaveActivity") {
      data = { clipSaveActivity: true };
    } else if (
      operationName === "ClipAddPlay" ||
      operationName === "ClipAddO"
    ) {
      data = {
        [operationName === "ClipAddPlay" ? "clipAddPlay" : "clipAddO"]: {
          __typename: "HistoryMutationResult",
          count: 1,
          history: ["2026-01-01T00:00:00Z"],
        },
      };
    } else if (operationName === "ClipUpdate") {
      data = {
        clipUpdate: {
          ...makeClip(Number(variables.input.id)),
          ...variables.input,
          last_played_at: null,
          resume_time: 0,
          play_duration: 0,
          play_history: [],
          o_history: [],
        },
      };
    } else {
      await route.continue();
      return;
    }
    await route.fulfill({ json: { data } });
  });
});

test.afterEach(async ({ page }) => {
  expect(browserProblems.get(page)).toEqual([]);
});

test("blocked audio stays unmuted and offers tap recovery in clean mode", async ({
  page,
}) => {
  await preparePlayback(page, {
    muted: false,
    clean: true,
    rejectNext: true,
    deferNext: false,
  });
  await page.goto("/clips/feed");
  await expect
    .poll(() => page.evaluate(() => window.__feedTest.playCalls))
    .toBeGreaterThan(0);
  const activeVideo = page.locator(".clip-feed__video").first();
  await expect(activeVideo).toHaveJSProperty("muted", false);
  await page
    .getByRole("button", { name: "Tap to play with sound", exact: true })
    .click();
  await expect(activeVideo).toHaveJSProperty("paused", false);
  await expect(activeVideo).toHaveJSProperty("muted", false);
});

test("one sound-enabled player survives 100 transitions, pagination and queue resets", async ({
  page,
}) => {
  test.setTimeout(90000);
  await startWithSound(page);
  const player = page.locator(".clip-feed__video");
  const original = await player.elementHandle();
  expect(
    await page.evaluate(() => window.__feedTest.playsInGesture.at(-1))
  ).toBe(true);

  for (let index = 1; index <= 100; index++) {
    await goToClip(page, index);
    await expect(player).toHaveCount(1);
    await expect(player).toHaveJSProperty("muted", false);
    expect(
      await original!.evaluate(
        (element) => element === document.querySelector(".clip-feed__video")
      )
    ).toBe(true);
  }

  await goToClip(page, 99);
  await page.locator('.clip-feed__topbar button[title="Newest first"]').click();
  await expect(player).toHaveAttribute("data-clip-id", "1");
  await expect(player).toHaveJSProperty("paused", false);
  expect(
    await original!.evaluate(
      (element) => element === document.querySelector(".clip-feed__video")
    )
  ).toBe(true);
  await expect(player).toHaveJSProperty("muted", false);
});

test("late playback failure cannot change the new clip's sound or playback", async ({
  page,
}) => {
  await preparePlayback(page, {
    muted: false,
    clean: false,
    rejectNext: false,
    deferNext: true,
  });
  await page.goto("/clips/feed");
  await expect
    .poll(() => page.evaluate(() => !!window.__feedTest.rejectDeferred))
    .toBe(true);
  await goToClip(page, 1);
  await page.evaluate(() => window.__feedTest.rejectDeferred!());
  const player = page.locator(".clip-feed__video");
  await expect(player).toHaveJSProperty("muted", false);
  await expect(player).toHaveJSProperty("paused", false);
  await expect(page.locator(".clip-feed__recovery")).toHaveCount(0);
});

test("a media error offers a working retry and leaves swiping available", async ({
  page,
}) => {
  await preparePlayback(page);
  let attempts = 0;
  await page.route("**/__feed_test__/clip-1.mp4", (route) => {
    attempts++;
    return serveVideo(
      route,
      attempts === 1 ? Buffer.from("invalid media") : video
    );
  });
  await page.goto("/clips/feed");
  await page
    .getByRole("button", {
      name: "Couldn't play this clip. Tap to retry",
      exact: true,
    })
    .click();
  const player = page.locator(".clip-feed__video");
  await expect
    .poll(() =>
      player.evaluate(
        (el: HTMLVideoElement) => !el.paused && el.currentTime > 0.05
      )
    )
    .toBe(true);
  await expect(page.locator(".clip-feed__recovery")).toHaveCount(0);
  expect(attempts).toBeGreaterThan(1);
  await goToClip(page, 1);
});

test("taps pause immediately, clips loop, and O, organised, rating and seeking still work", async ({
  page,
}, testInfo) => {
  const mutations: IClipMutation[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/graphql") && request.method() === "POST") {
      const body = request.postDataJSON();
      if (body.operationName.startsWith("Clip")) mutations.push(body);
    }
  });
  await startWithSound(page);
  const player = page.locator(".clip-feed__video");
  const item = page.locator(".clip-feed__item.is-active");
  expect(
    await item.locator(".clip-feed__stage").evaluate((element) => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return (document.querySelector(".clip-feed__video") as HTMLVideoElement)
        .paused;
    })
  ).toBe(true);
  await item.locator(".clip-feed__stage").click();
  await expect(player).toHaveJSProperty("paused", false);
  await item.locator(".clip-feed__stage").dblclick();
  expect(mutations.filter((m) => m.operationName === "ClipAddO")).toHaveLength(
    0
  );

  await item.locator(".clip-feed__rail-btn--o").click();
  await expect(item.locator(".clip-feed__rail-count")).toHaveText("1");
  const organized = item.locator(
    "button.clip-feed__rail-btn:not(.clip-feed__rail-btn--o)"
  );
  await organized.click();
  await expect(organized).toHaveClass(/is-active/);
  await item.locator(".clip-feed__rating input").fill("8.4");
  await item.locator(".clip-feed__rating input").blur();
  expect(mutations.some((m) => m.variables.input?.rating100 === 84)).toBe(true);

  const bar = await item.locator(".clip-feed__progress").boundingBox();
  await page.mouse.click(bar!.x + bar!.width / 2, bar!.y + bar!.height / 2);
  await expect
    .poll(() => player.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(1.3);
  await player.evaluate((el: HTMLVideoElement) => {
    el.currentTime = el.duration - 0.05;
  });
  await expect
    .poll(() => player.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeLessThan(1);
  await expect(player).toHaveAttribute("data-clip-id", "1");
  await expect(player).toHaveJSProperty("loop", true);
  await goToClip(page, 1);
  await goToClip(page, 0);
  await expect(item.locator(".clip-feed__rail-count")).toHaveText("1");
  await expect(organized).toHaveClass(/is-active/);
  await expect(item.locator(".clip-feed__rating input")).toHaveValue("8.4");
  await testInfo.attach("feed-layout", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("activity belongs to the outgoing clip, seeking and background time are excluded", async ({
  page,
}) => {
  const mutations: IClipMutation[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/graphql") && request.method() === "POST") {
      const body = request.postDataJSON();
      if (body.operationName.startsWith("Clip")) mutations.push(body);
    }
  });
  await startWithSound(page);
  const player = page.locator(".clip-feed__video");
  await expect
    .poll(() => player.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0.65);
  const bar = await page
    .locator(".clip-feed__item.is-active .clip-feed__progress")
    .boundingBox();
  await page.mouse.click(bar!.x + bar!.width * 0.65, bar!.y + bar!.height / 2);
  await expect
    .poll(() => player.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(1.8);
  await goToClip(page, 1);
  const activity = mutations.find(
    (m) => m.operationName === "ClipSaveActivity"
  );
  expect(activity?.variables.id).toBe("1");
  expect(activity?.variables.resume_time).toBeGreaterThan(1.8);
  expect(activity?.variables.playDuration).toBeGreaterThan(0.5);
  expect(activity?.variables.playDuration).toBeLessThan(1.5);
  await goToClip(page, 0);
  expect(
    mutations.filter(
      (m) => m.operationName === "ClipAddPlay" && m.variables.id === "1"
    )
  ).toHaveLength(1);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(player).toHaveJSProperty("paused", true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(player).toHaveJSProperty("paused", false);
  await page.locator(".clip-feed__item.is-active .clip-feed__stage").click();
  await expect(player).toHaveJSProperty("paused", true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(player).toHaveJSProperty("paused", true);
});

test("rapid scrolling and viewport resizing keep the visible clip active", async ({
  page,
}) => {
  await startWithSound(page);
  await page.locator(".clip-feed__scroller").evaluate((element) => {
    for (const index of [1, 8, 3, 12, 2]) {
      element.scrollTo({ top: index * element.clientHeight });
    }
  });
  await expect(page.locator(".clip-feed__video")).toHaveAttribute(
    "data-clip-id",
    "3"
  );
  await page.setViewportSize({ width: 390, height: 600 });
  await expect
    .poll(() =>
      page
        .locator(".clip-feed__scroller")
        .evaluate((el) => Math.round(el.scrollTop / el.clientHeight))
    )
    .toBe(2);
  await expect(page.locator(".clip-feed__video")).toHaveAttribute(
    "data-clip-id",
    "3"
  );
});

test("leaving the feed pauses the detached player and saves activity", async ({
  page,
}) => {
  await startWithSound(page);
  const player = page.locator(".clip-feed__video");
  const original = await player.elementHandle();
  await expect
    .poll(() => player.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0.65);
  const saved = page.waitForRequest(
    (request) =>
      request.url().endsWith("/graphql") &&
      request.method() === "POST" &&
      request.postDataJSON().operationName === "ClipSaveActivity"
  );
  await page.locator('.clip-feed__topbar button[title="Close"]').click();
  await page.waitForURL((url) => url.pathname === "/clips");
  expect(await original!.evaluate((el: HTMLVideoElement) => el.paused)).toBe(
    true
  );
  expect((await saved).postDataJSON().variables.id).toBe("1");
});
