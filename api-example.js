import Proxy from './lib/Proxy.js';
import getContent from './lib/getContent.js';
import makeRequest from './lib/makeRequest.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
    .locale('en')
    .option('api-url', {
        description: 'API URL',
        default: 'http://127.0.0.1:3000',
        type: 'string'
    })
    .option('client-key', {
        description: 'Client Key',
        demandOption: true,
        type: 'string'
    })
    .option('url', {
        description: 'Target URL to access',
        default: 'https://2captcha.com/demo/cloudflare-turnstile-challenge',
        demandOption: true,
        type: 'string'
    })
    .option('proxy-scheme', {
        description: 'Proxy scheme',
        default: 'http',
        type: 'string'
    })
    .option('proxy-host', {
        description: 'Proxy host',
        default: '127.0.0.1',
        type: 'string'
    })
    .option('proxy-port', {
        description: 'Proxy port',
        default: 1080,
        type: 'number'
    })
    .help()
    .argv;

const API_URL = argv['api-url'];
const proxyConfig = argv['proxy-host'] && argv['proxy-port'] ? {
    scheme: argv['proxy-scheme'],
    host: argv['proxy-host'],
    port: argv['proxy-port']
} : null;

async function solveTurnstile(clientKey, url, siteKey, action = null, proxyConfig = null) {
    const createTaskData = {
        clientKey: clientKey,
        type: "Turnstile",
        url: url,
    };

    if (siteKey) createTaskData.sitekey = siteKey;
    if (action) createTaskData.action = action;
    if (proxyConfig) createTaskData.proxy = proxyConfig;

    console.debug("Call new captcha task:", createTaskData);

    const isHttps = url.startsWith('https');
    const proxy = proxyConfig ? new Proxy({
        [proxyConfig.scheme === 'socks5' ? 'socks' : (isHttps ? 'https' : 'http')]: 
            proxyConfig.scheme === 'socks5' 
                ? `socks5://${proxyConfig.host}:${proxyConfig.port}`
                : `${proxyConfig.scheme}://${proxyConfig.host}:${proxyConfig.port}`
    }) : null;
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        agent: proxy?.getAgent(),
        api: true,
    };

    const response = await makeRequest(`${API_URL}/createTask`, options, createTaskData);

    const taskData = response.data;
    const taskId = taskData.taskId;

    if (!taskId) {
        throw new Error("No taskId received");
    }
    console.debug(`New captcha task started: ${taskId}`);

    for (let i = 0; i < 30; i++) {
        const checkData = { clientKey, taskId };
        const checkResponse = await makeRequest(
            `${API_URL}/getTaskResult`,
            options,
            checkData
        );

        const data = checkResponse.data;

        if (data.status === "failed") {
            throw new Error(`Task failed: ${data.errormessage || 'Unknown error occurs.'}`);
        }

        if (data.status === "completed") {
            const result = data.result;
            if (!result.success) {
                throw new Error(`Task failed: ${result.errormessage || 'Unknown error occurs.'}`);
            }
            return result.response;
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    throw new Error("timeout to get result");
}

async function solveChallenge(clientKey, url, proxyConfig = null) {
    const createTaskData = {
        clientKey: clientKey,
        type: "CloudflareChallenge",
        url: url,
        proxy: proxyConfig,
        content: true,
    };

    if (proxyConfig) createTaskData.proxy = proxyConfig;

    console.debug("Call new captcha task:", createTaskData);

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        api: true,
    };

    const response = await makeRequest(`${API_URL}/createTask`, options, createTaskData);
    const taskData = response.data;
    const taskId = taskData.taskId;

    if (!taskId) {
        throw new Error("No taskId received");
    }
    console.debug(`New captcha task started: ${taskId}`);

    for (let i = 0; i < 30; i++) {
        const checkData = { clientKey, taskId };
        const checkResponse = await makeRequest(
            `${API_URL}/getTaskResult`,
            options,
            checkData
        );

        const data = checkResponse.data;

        console.log(data)

        if (data.status === "failed") {
            throw new Error(`Task failed: ${data.error || 'Unknown error occurs.'}`);
        }

        if (data.status === "completed") {
            const result = data.result || {};
            if (!result.success) {
                throw new Error(`Task failed: ${result.error || 'Unknown error occurs.'}`);
            }
            return [result.response, result.data.userAgent];
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    throw new Error("timeout to get result");
}

async function main() {
    try {
        const [cfClearance, ua] = await solveChallenge(
            argv['client-key'],
            argv['url'],
            proxyConfig
        );

        console.log('CF Clearance:', cfClearance);
        console.log('User Agent:', ua);

        const content = await getContent(
            argv['url'],
            proxyConfig,
            cfClearance,
            ua
        );

        console.log('Content:', content);
    } catch (error) {
        console.error(error);
    }
}

// Run the main function
main();
