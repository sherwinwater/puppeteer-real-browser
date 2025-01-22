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

        // Step 1: Load Start URL
        console.log('Navigating to start URL...');
        await page.goto(startUrl, { waitUntil: 'networkidle0' });
        await delay(10000); // Wait to ensure the page fully loads

        // Step 2: Fetch API Parameters
        const apiParams = await page.evaluate(() => {
            const jsonData = JSON.parse(
                document
                    .querySelector('script[type="application/json"][id="__NEXT_DATA__"]')
                    .textContent.replaceAll('\\n', '').replaceAll('\\t', '')
            );
            const fingerprintId = new URLSearchParams(
                document.querySelector('#trkBox > img:nth-child(1)').getAttribute('src')
            ).get('dvfpid');
            return {
                fingerprintId,
                totalJobAds: jsonData.props.pageProps.jobResultsData.estimatedTotalSize,
                searchId: jsonData.props.pageProps.jobResultsData.searchId,
                apiKey: jsonData.runtimeConfig.api.key,
                searchQuery: window.location.pathname.split('/').pop().split('?')[0].split('-job')[0].split('q-')[1].replaceAll('-', ' '),
            };
        });

        console.log('API Parameters fetched:', apiParams);

        // Step 3: Loop through Pages
        while (true) {
            // Scrape jobs from the current page
            const jobListings = await page.evaluate((apiParams) => {
                return Array.from(document.querySelectorAll('[data-testid="JobCard"]')).map((card) => ({
                    title: card.querySelector('[data-testid="jobTitle"]')?.textContent?.trim() || '',
                    company: card.querySelector('[data-testid="company"]')?.textContent?.trim() || '',
                    location: card.querySelector('[data-testid="jobDetailLocation"]')?.textContent?.trim() || '',
                    postedTime: card.querySelector('[data-testid="jobDetailDateRecency"]')?.textContent?.trim() || '',
                    jobUrl: card.querySelector('[data-testid="jobTitle"]')?.href || '',
                    scrapedAt: new Date().toISOString(),
                }));
            }, apiParams);

            console.log(`Found ${jobListings.length} jobs on the current page.`);
            await appendToFile(filename, jobListings);

            // Check if there is a next page
            const hasNextPage = await page.evaluate(() => {
                const loadMoreButton = document.querySelector('[data-testid="svx-load-more-button"]');
                if (loadMoreButton) {
                    loadMoreButton.click();
                    return true;
                }
                return false;
            });

            if (!hasNextPage) {
                console.log('No more pages to load.');
                break;
            }

            await delay(5000); // Wait for the next page to load
        }
    } catch (error) {
        console.error('Error during scraping:', error);
    } finally {
        await browser.close();
    }


}

test();