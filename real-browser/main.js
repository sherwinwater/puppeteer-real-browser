/*********************
 * Node.js imports
 *********************/
const { writeFile, readFile, access } = require("fs/promises");

/*********************
 * Scraping library 
 * (replace this with your actual import path)
 *********************/
const { connect } = require("../lib/cjs/index.js");

// For demonstration; not strictly required here:
const test = require("node:test");
const assert = require("node:assert");

/*********************
 * Utility: Append data to JSON file
 *********************/
async function appendToFile(filename, data) {
  try {
    let existingData = [];
    try {
      // Check if file exists
      await access(filename);
      const fileContent = await readFile(filename, "utf8");
      existingData = JSON.parse(fileContent);
    } catch (e) {
      // File doesn't exist yet; it's safe to continue
    }

    // Merge new data
    const newData = existingData.concat(data);
    await writeFile(filename, JSON.stringify(newData, null, 2));

  } catch (error) {
    console.error("Error writing to file:", error);
  }
}

/*********************
 * Puppeteer/Playwright Options
 * (Adjust to your environment)
 *********************/
const realBrowserOption = {
  args: ["--start-maximized"],
  turnstile: true,   // e.g., cloudflare Turnstile
  headless: false,
  customConfig: {},
  connectOption: {
    defaultViewport: null,
  },
  plugins: [],
};

/*********************
 * Main scraping function
 *********************/
async function testScraper() {
  console.log("Starting scraper...");

  // Connect to the real browser (puppeteer or playwright)
  const { browser, page } = await connect(realBrowserOption);

  // Simple helper for "blind" waits
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    // Example URL
    const webpageUrl = "https://grabjobs.co/denmark/jobs-in-denmark";
    const url = new URL(webpageUrl);
    const country = url.pathname.split("/")[1];
    const filename = `${country}_job_listings.json`;

    // Go to the first page
    await page.goto(webpageUrl, { waitUntil: "networkidle0" });
    await delay(2000);

    // This is the primary loop to handle all pages
    while (true) {
      // Ensure the job listings are present
      try {
        await page.waitForFunction(
          () => document.querySelectorAll("a.link-card").length > 0,
          { timeout: 10000 }
        );
      } catch (err) {
        console.log("No job listings found on this page (or timed out).");
        break;
      }

      // Get the current page number from the URL's "p" parameter, fallback "1"
      const currentUrl = await page.url();
      const currentPage = new URL(currentUrl).searchParams.get("p") || "1";

      // Scrape job listings
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

      // Save job listings to local file
      await appendToFile(filename, jobListings);
      console.log(`Saved ${jobListings.length} jobs from page ${currentPage}`);

      // Check for a "next" button on the pagination
      // The selector used in your code is "a.rounded-e-md:not(.text-gray-400)"
      // Make sure it actually matches the "Next" page button on ALL pages
      const nextButtonSelector = "a.rounded-e-md:not(.text-gray-400)";
      const nextButton = await page.$(nextButtonSelector);

      if (!nextButton) {
        // No next button => probably last page
        console.log("No more pages found. Exiting loop.");
        break;
      }

      // **Important**: Use page.click (await nextButton.click()) instead of
      // page.evaluate(() => btn.click()) so Puppeteer can handle it properly
      await nextButton.click();

      // Now we must wait for something that indicates "new page is loaded"
      // If the site does a full page reload:
      //   await page.waitForNavigation({ waitUntil: "networkidle0" });
      //
      // If the site uses AJAX to load new data in place:
      //   We'll wait for a new set of job cards or a new page parameter
      //   This can be done in many ways. For example, just a blind wait:
      //     await delay(5000);
      //   ... or a more robust waitForFunction that checks the page param:
      //
      // Option A: Wait for the "p" param to change
      //    If it increments each time, we can do something like:
      await page.waitForFunction((oldPage) => {
        const newPage = new URL(location.href).searchParams.get("p") || "1";
        return newPage !== oldPage;
      }, { timeout: 10000 }, currentPage);

      // Optionally you can also add a small delay to let things settle
      await delay(2000);
    }

  } catch (error) {
    console.error("Error during scraping:", error);
  } finally {
    // Close the browser to free resources
    await browser.close();
  }
}

// Run the scraper
testScraper();
