// import { writeFile, readFile, access } from 'fs/promises';
const { writeFile, readFile, access } = require("fs/promises");

const { connect } = require("../../lib/cjs/index.js");
const test = require("node:test");
const assert = require("node:assert");

async function appendToFile(filename, data) {
  try {
    let existingData = [];
    try {
      await access(filename);
      const fileContent = await readFile(filename, "utf8");
      existingData = JSON.parse(fileContent);
    } catch (e) {
      // File doesn't exist yet
    }
    const newData = existingData.concat(data);
    await writeFile(filename, JSON.stringify(newData, null, 2));
  } catch (error) {
    console.error("Error writing to file:", error);
  }
}

const realBrowserOption = {
  args: ["--start-maximized"],
  turnstile: true,
  headless: false,
  customConfig: {},
  connectOption: {
    defaultViewport: null,
  },
//   proxy: {
//     host: "proxy.apify.com",
//     port: "8000",
//     username: "gr",
//     password: "",
//   },
  plugins: [],
};

async function testScraper() {
  console.log("Starting scraper...");

  const { browser, page } = await connect(realBrowserOption);

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    const webpageUrl = "https://grabjobs.co/denmark/jobs-in-denmark";
    const url = new URL(webpageUrl);
    const country = url.pathname.split("/")[1];
    const filename = `${country}_job_listings.json`;

    await page.goto(webpageUrl, { waitUntil: "networkidle0" });
    await delay(2000);

    while (true) {
      try {
        await page.waitForFunction(
          () => document.querySelectorAll("a.link-card").length > 0,
          { timeout: 10000 }
        );
      } catch (e) {
        console.log("No job listings found on page");
        break;
      }

      const currentUrl = await page.url();
      const currentPage = new URL(currentUrl).searchParams.get("p") || "1";

      const jobListings = await page.evaluate((pageNum) => {
        return Array.from(document.querySelectorAll("a.link-card")).map(
          (card) => {
            return {
              title: card.querySelector("h2")?.textContent?.trim() || "",
              company: card.querySelector("h3")?.textContent?.trim() || "",
              location:
                card
                  .querySelector('img[alt="geo-alt icon"]')
                  ?.closest("p")
                  ?.querySelector("span")
                  ?.textContent?.trim() || "",
              jobType:
                card
                  .querySelector('img[alt="briefcase icon"]')
                  ?.closest("p")
                  ?.querySelector("span")
                  ?.textContent?.trim() || "",
              description:
                card.querySelector(".break-words")?.textContent?.trim() || "",
              jobUrl: card.href || "",
              postedTime:
                card
                  .querySelector(".text-sm:last-child")
                  ?.textContent?.trim() || "",
              scrapedAt: new Date().toISOString(),
              pageNumber: pageNum,
            };
          }
        );
      }, currentPage);

      await appendToFile(filename, jobListings);
      console.log(`Saved ${jobListings.length} jobs from page ${currentPage}`);

      const hasNextPage = await page.evaluate(() => {
        const nextButton = document.querySelector(
          "a.rounded-e-md:not(.text-gray-400)"
        );
        if (nextButton) {
          nextButton.click();
          return true;
        }
        return false;
      });

      if (!hasNextPage) break;
      await delay(5000);
    }
  } catch (error) {
    console.error("Error during scraping:", error);
  } finally {
    await browser.close();
  }
}

testScraper();
