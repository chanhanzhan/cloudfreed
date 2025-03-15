import http from 'http';
import net from 'net';
import Proxy from './Proxy.js';

class ProxyAgent {
  constructor(proxyConfig) {
    if (proxyConfig.startsWith('socks')) {
      this.proxy = new Proxy({ socks: proxyConfig });
    } else {
      this.httpProxy = new Proxy({ http: proxyConfig });
      this.httpsProxy = new Proxy({ https: proxyConfig });
    }
    this.server = null;
    this.port = null;
  }

  getProxy(protocol) {
    if (this.proxy) {
      return this.proxy;
    }
    return protocol === 'https:' ? this.httpsProxy : this.httpProxy;
  }

  async start() {
    this.server = http.createServer((req, res) => {
      const options = {
        hostname: req.headers.host.split(':')[0],
        port: req.headers.host.split(':')[1] || 80,
        path: req.url,
        method: req.method,
        headers: req.headers,
        agent: this.getProxy(req.protocol || 'http:').getAgent()
      };

      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });

      req.pipe(proxyReq);

      proxyReq.on('error', (err) => {
        res.writeHead(500);
        res.end('Proxy Error: ' + err.message);
      });
    });

    this.server.on('connect', (req, clientSocket, head) => {
      const { port, hostname } = new URL(`http://${req.url}`);
      const serverSocket = net.connect(
        {
          host: hostname,
          port: port || 443,
          agent: this.getProxy('https:').getAgent()
        },
        () => {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          serverSocket.write(head);
          serverSocket.pipe(clientSocket);
          clientSocket.pipe(serverSocket);
        }
      );

      serverSocket.on('error', (err) => {
        clientSocket.end();
      });
    });

    return new Promise((resolve, reject) => {
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = null;
    }
  }

  getProxyUrl() {
    console.log(this.port ? `http://127.0.0.1:${this.port}` : null)
    return this.port ? `http://127.0.0.1:${this.port}` : null;
  }
}

export default ProxyAgent;
