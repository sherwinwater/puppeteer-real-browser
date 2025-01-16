import { writeFile, readFile, access } from 'fs/promises';
import puppeteer from 'puppeteer';
import { newInjectedPage } from 'fingerprint-injector';

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

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const TARGET_URL = 'https://grabjobs.co/canada/jobs-in-canada';
// const TARGET_URL = 'https://grabjobs.co/denmark/jobs-in-denmark';

const url = new URL(TARGET_URL);
const country = url.pathname.split('/')[1];
const filename = `${country}_job_listings.json`;

async function scrape(url = TARGET_URL) {
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // const browser = await puppeteer.launch({
    //     headless: false,
    //     args: ['--no-sandbox', '--disable-setuid-sandbox',"proxy-server=groups-RESIDENTIAL,country-CA:@proxy.apify.com:8000"]
    // });

    const page = await newInjectedPage(
        browser,
        {
            // constraints for the generated fingerprint
            fingerprintOptions: {
                // Which browsers to consider. For example: ['chrome', 'firefox', 'safari']
                browsers: ['chrome'],
                // Which device types to consider. Valid values: ['mobile', 'desktop']
                devices: ['mobile'],
                // Operating systems to consider. For example: ['windows', 'macos', 'linux', 'android', 'ios']
                operatingSystems: ['ios'],
                // Which locales/languages to consider
                locales: ['en-US'],

                // (Optional) Constraints on screen size
                // Useful if you want a certain range of device sizes.
                minScreenWidth: 360,
                maxScreenWidth: 414,
                minScreenHeight: 640,
                maxScreenHeight: 896,
            },
        },
    );

    console.log(page)

    try {
        console.log(`Connected! Navigating to ${url}...`);
        await page.goto(url, {timeout: 2 * 60 * 1000});
        console.log(`Navigated! Scraping page content...`);
        const data = await page.content();
        console.log(`Scraped! Data: ${data}`);


        while (true) {
            try {
                await page.waitForFunction(() =>
                        document.querySelectorAll('a.link-card').length > 0,
                    { timeout: 10000 }
                );
            } catch (e) {
                console.log('No job listings found on page');
                break;
            }

            const currentUrl = await page.url();
            const currentPage = new URL(currentUrl).searchParams.get('p') || '1';

            const jobListings = await page.evaluate((pageNum) => {
                return Array.from(document.querySelectorAll('a.link-card')).map(card => {
                    return {
                        title: card.querySelector('h2')?.textContent?.trim() || '',
                        company: card.querySelector('h3')?.textContent?.trim() || '',
                        location: card.querySelector('img[alt="geo-alt icon"]')?.closest('p')?.querySelector('span')?.textContent?.trim() || '',
                        jobType: card.querySelector('img[alt="briefcase icon"]')?.closest('p')?.querySelector('span')?.textContent?.trim() || '',
                        description: card.querySelector('.break-words')?.textContent?.trim() || '',
                        jobUrl: card.href || '',
                        postedTime: card.querySelector('.text-sm:last-child')?.textContent?.trim() || '',
                        scrapedAt: new Date().toISOString(),
                        pageNumber: pageNum
                    };
                });
            }, currentPage);

            await appendToFile(filename, jobListings);
            console.log(`Saved ${jobListings.length} jobs from page ${currentPage}`);

            const hasNextPage = await page.evaluate(() => {
                const nextButton = document.querySelector('a.rounded-e-md:not(.text-gray-400)');
                if (nextButton) {
                    nextButton.click();
                    return true;
                }
                return false;
            });

            if (!hasNextPage) break;
            await delay(5000);
        }


    } finally {
        await browser.close();
    }
}

scrape();