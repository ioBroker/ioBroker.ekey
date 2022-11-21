const EventEmitter = require('events');
const dgram = require('dgram');

class EKey extends EventEmitter {
    constructor(port) {
        super();
        this.server = null;
        this.port = port;
    }

    close() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }

    start() {
        this.server = dgram.createSocket('udp4');

        this.server.on('error', err => {
            this.server.close();
            this.emit('error', err);
        });

        this.server.on('listening', () => {
            const address = this.server.address();
            this.emit('debug', `adapter listening ${address.address}:${address.port}`);
        });

        this.server.on('message', (message, rinfo) => {
            this.emit('data', rinfo.address, rinfo.port, message);
        });

        this.server.bind(this.port);
    }
}

module.exports = EKey;

