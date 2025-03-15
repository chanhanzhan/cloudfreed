import https from "https";
import http from "http";

function makeRequest(url, options, data = null, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const isHttps = url.startsWith('https');
        const client = isHttps ? https : http;
        
        // Add max redirect check
        if (redirectCount >= 20) {
            reject(new Error('Too many redirects'));
            return;
        }

        console.log(`Accessing ${options.method} ${url}`);

        const req = client.request(url, options, (res) => {
            let responseData = '';
            let dataSize = 0;
            const maxSize = 5 * 1024 * 1024; // 5MB

            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // Create new options object for redirect request
                const redirectOptions = { ...options };
                const redirectUrl = new URL(res.headers.location, url).href;
                
                // Follow the redirect with the same method and headers, increment redirect count
                return makeRequest(redirectUrl, redirectOptions, data, redirectCount + 1)
                    .then(resolve)
                    .catch(reject);
            }

            res.on('data', (chunk) => {
                dataSize += chunk.length;
                if (dataSize > maxSize) {
                    req.destroy();
                    reject(new Error('Response size exceeded 5MB limit'));
                    return;
                }
                responseData += chunk;
            });
            
            res.on('end', () => {
                if (options.api) {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const jsonData = JSON.parse(responseData);
                            resolve({ ok: true, data: jsonData });
                        } catch (e) {
                            reject(new Error(`API Response Error: ${res.statusCode} ${responseData}`));
                        }
                    } else {
                        reject(new Error(`API Error: ${res.statusCode} ${responseData}`));
                    }
                } else {
                    resolve({
                        data: responseData,
                        status: res.statusCode,
                        headers: res.headers
                    });
                }
            });
        });
        
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Request timed out after 30 seconds'));
        });

        req.on('error', (error) => {
            reject(error);
        });

        if (data) {
            req.write(JSON.stringify(data));
        }
        
        req.end();
    });
}

export default makeRequest;