import { connect } from "puppeteer-real-browser";
import { writeFile, readFile, access } from 'fs/promises';

async function appendToFile(filename, data) {
    try {
        let existingData = [];
        try {
            await access(filename);
            const fileContent = await readFile(filename, 'utf8');
            existingData = JSON.parse(fileContent);
        } catch (e) {
            // File doesn't exist yet
        }
        const newData = existingData.concat(data);
        await writeFile(filename, JSON.stringify(newData, null, 2));
    } catch (error) {
        console.error('Error writing to file:', error);
    }
}

const isHeadless = false;
// const isHeadless = process.env.HEADLESS === 'true';

async function test() {
    console.log("start")
    const { browser, page } = await connect({
        headless: isHeadless,
        args: [
            '--disable-web-security',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920x1080',
            '--hide-scrollbars',
            '--disable-notifications',
            '--disable-extensions',
            '--force-device-scale-factor=1',
            '--disable-blink-features=AutomationControlled',
            ...(isHeadless ? ['--display=' + process.env.DISPLAY] : [])
        ],
        customConfig: {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        turnstile: true,
        connectOption: {},
        disableXvfb: false,
        ignoreAllFlags: false
    });

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    try {
        const startUrl = 'https://www.monster.ca/jobs/';
        const filename = 'job_listings.json';

        // Go to the starting URL
        await page.goto(startUrl, { waitUntil: 'networkidle0' });
        await delay(2000);

        // Step 1: Scrape Categories
        const categories = await page.evaluate(() => {
            return Array.from(
                document.querySelectorAll("div.browse-jobs-list__list ul li a")
            ).map((category) => ({
                name: category.textContent.trim(),
                url: category.href,
            }));
        });

        console.log(`Found ${categories.length} categories`);
        for (const category of categories) {
            console.log(`Processing category: ${category.name}`);

            // Navigate to the category page
            await page.goto(category.url, { waitUntil: 'networkidle0' });
            await delay(2000);

            // Step 2: Scrape Subcategories
            const subcategories = await page.evaluate(() => {
                return Array.from(
                    document.querySelectorAll("div.browse-jobs-list__list ul li a")
                ).map((subcategory) => ({
                    name: subcategory.textContent.trim(),
                    url: subcategory.href,
                }));
            });

            console.log(`Found ${subcategories.length} subcategories in ${category.name}`);
            for (const subcategory of subcategories) {
                console.log(`Processing subcategory: ${subcategory.name}`);

                // Navigate to the subcategory page
                await page.goto(subcategory.url, { waitUntil: 'networkidle0' });
                await delay(2000);

                // Step 3: Scrape Jobs
                while (true) {
                    try {
                        await page.waitForFunction(
                            () => document.querySelectorAll('[data-testid="JobCard"]').length > 0,
                            { timeout: 10000 }
                        );
                    } catch (e) {
                        console.log(`No job listings found in ${subcategory.name}`);
                        break;
                    }

                    const currentUrl = await page.url();
                    const currentPage = new URL(currentUrl).searchParams.get('page') || '1';

                    const jobListings = await page.evaluate((pageNum) => {
                        return Array.from(document.querySelectorAll('[data-testid="JobCard"]')).map((card) => ({
                            title: card.querySelector('[data-testid="jobTitle"]')?.textContent?.trim() || '',
                            company: card.querySelector('[data-testid="company"]')?.textContent?.trim() || '',
                            location: card.querySelector('[data-testid="jobDetailLocation"]')?.textContent?.trim() || '',
                            postedTime: card.querySelector('[data-testid="jobDetailDateRecency"]')?.textContent?.trim() || '',
                            jobUrl: card.querySelector('[data-testid="jobTitle"]')?.href || '',
                            scrapedAt: new Date().toISOString(),
                            pageNumber: pageNum,
                        }));
                    }, currentPage);

                    await appendToFile(filename, jobListings);
                    console.log(`Saved ${jobListings.length} jobs from page ${currentPage} of ${subcategory.name}`);

                    const hasNextPage = await page.evaluate(() => {
                        const loadMoreButton = document.querySelector('[data-testid="svx-load-more-button"]');
                        if (loadMoreButton) {
                            loadMoreButton.click();
                            return true;
                        }
                        return false;
                    });

                    if (!hasNextPage) {
                        console.log(`No more pages in ${subcategory.name}`);
                        break;
                    }

                    await delay(5000); // Wait for the next page to load
                }
            }
        }
    } catch (error) {
        console.error('Error during scraping:', error);
    } finally {
        await browser.close();
    }



}

test();