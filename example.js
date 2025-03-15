import CloudFreed from "./lib/CloudFreed.js";

const CF = new CloudFreed();
const instance = await CF.start(false, true);

const args = process.argv.slice(2);
const testsToRun = args.length > 0 ? args : ['recaptcha-invisible', 'cloudflare-invisible', 'cf-challenge-iuam', 'cf-challenge', 'turnstile'];

try {
  const tests = {
    'recaptcha-invisible': async () => {
      console.log(
        await instance.Solve({
          type: "RecaptchaInvisible",
          url: "https://antcpt.com/score_detector/",
          sitekey: "6LcR_okUAAAAAPYrPe-HK_0RULO1aZM15ENyM-Mf",
          action: "homepage",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
        })
      );
    },
    
    'cloudflare-invisible': async () => {
      console.log(
        await instance.Solve({
          type: "CloudflareInvisible",
          url: "discord.com",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
        })
      );
    },
    
    'cf-challenge-iuam': async () => {
      console.log(
        await instance.Solve({
          type: "CloudflareChallenge",
          url: "bloxmoon.com",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
          // proxy: { scheme: "socks5", host: "127.0.0.1", port: 1080 },
        })
      );
    },
    
    'cf-challenge': async () => {
      console.log(
        await instance.Solve({
          type: "CloudflareChallenge",
          url: "grok.com",
          // proxy: { scheme: "socks5", host: "127.0.0.1", port: 1080 },
        })
      );
    },
    
    'turnstile': async () => {
      console.log(
        await instance.Solve({
          type: "Turnstile",
          url: "www.coronausa.com",
          sitekey: "0x4AAAAAAAH4-VmiV_O_wBN-",
        })
      );
    },

    'nebula': async () => {
      console.log(
        await instance.Solve({
          type: "Turnstile",
          url: "https://web.nebula-media.org/",
          sitekey: "0x4AAAAAAADGwT_-TpuCDrw9",
          timeout: 5,
        })
      );
    },

    'charon': async () => {
      console.log(
        await instance.Solve({
          type: "CloudflareChallenge",
          url: "https://vip.charontv.com/challenge?id=123456",
          proxy: { scheme: "http", host: "127.0.0.1", port: 1080 },
          content: true,
        })
      );
    },
  };

  for (const test of testsToRun) {
    if (tests[test]) {
      console.log(`Running test: ${test}`);
      await tests[test]();
    } else {
      console.warn(`Unknown test: ${test}`);
    }
  }

} catch (error) {
  console.error('Error occurred:', error);
} finally {
  await instance.Close();
}
