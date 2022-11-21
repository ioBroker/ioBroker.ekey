const EventEmitter = require('events');
let SerialPort = null;

const STATES = {
    WAITING_FOR_START: 0,
    WAITING_FOR_LENGTH: 1,
    WAITING_FOR_LENGTH_EXTENSION: 2,
    WAITING_FOR_PAYLOAD: 3,
};

const START_BYTE = 0x02;
const END_BYTE = 0x03;

class EKey extends EventEmitter {
    constructor(portName, baudRate, dataBits, parity, stopBits, flowControl, timeout) {
        super();
        SerialPort = SerialPort || require('serialport').SerialPort;
        this.server = null;
        this.options = {
            path: portName,
            baudrate: baudRate || 9600,
            dataBits: dataBits || 8,
            stopBits: stopBits || 1,
            parity: parity || 'none',
            rtscts: flowControl === 'rtscts',
            xon: flowControl === 'xon',
            xoff: flowControl === 'xoff',
            xany: flowControl === 'xany',
        };
        this.timeoutMs = parseInt(timeout, 10) || 5000;
        this.frame = Buffer.alloc(1024);
        this.frameIndex = 0;
        this.frameLength = 0;
        this.state = STATES.WAITING_FOR_START;
    }

    close() {
        this.stopTimeout();

        if (this.server) {
            const server = this.server;
            this.server = null;
            return server.close();
        } else {
            return Promise.resolve();
        }
    }

    /**
     * Undo byte stuffing.
     * The data was inflated for transport avoid the occurrence of the start and end identifiers in the frame
     * 02 --> 3F 41
     * 03 --> 3F 81
     * 3F --> 3F C1
     *
     * This method undoes that.
     */
    deflate() {
        /*
         Let's assume that in the addressing part (index 0 to 14)
          no byte stuffing is used. This saves some time to go through here.
         */
        if (this.frameLength <= 15) {
            return;
        }

        let deflated;
        let i = 0;

        while (i < this.frameLength) {
            if (this.frame[i] === 0x3F) {
                deflated = false;
                switch (this.frame[i + 1]) {
                    case 0x41:
                        this.frame[i] = 2;
                        deflated = true;
                        break;
                    case 0x81:
                        this.frame[i] = 3;
                        deflated = true;
                        break;
                    case 0xC1:
                        this.frame[i] = 0x3F;
                        deflated = true;
                        break;
                    // Default: If anything else follows the 3F,
                    // then the 3F appears to be a normal data byte, so no deflating.
                    default:
                        break;
                }
                if (deflated) {
                    // compact data
                    for (let j = i + 1; j < this.frameLength; j++) {
                        this.frame[j] = this.frame[j + 1];
                    }
                    this.frameLength--;
                }
            }
            i++;
        }
    }

    processFrame() {
        let printFrame = false;
        // Validate
        if ((this.frame[0] !== START_BYTE)) {
            this.emit('warn', 'Wrong start byte');
            printFrame = true;
        }
        if (this.frame[this.frameLength - 1] !== END_BYTE) {
            this.emit('warn', 'Wrong tail byte');
            printFrame = true;
        }

        this.deflate();

        if (printFrame) {
            this.emit('info', `Raw Frame ${this.frameLength}, ${this.frame.slice(0, this.frameLength).toString('hex')}`);
        } else {
            this.emit('debug', `Raw Frame ${this.frameLength}, ${this.frame.slice(0, this.frameLength).toString('hex')}`);
        }

        if (this.frameLength === 47) {
            this.emit('finger', this.frame[17]);
        } else {
            this.emit('data', this.frame.slice(0, this.frameLength));
        }
    }

    timeoutError() {
        this.emit('warn', 'Timeout');
        this.state = STATES.WAITING_FOR_START;
    }

    startTimeout() {
        this.timeout && clearTimeout(this.timeout);
        this.timeout = setTimeout(() => {
            this.timeout = null;
            this.timeoutError();
        }, this.timeoutMs);
    }

    stopTimeout() {
        this.timeout && clearTimeout(this.timeout);
        this.timeout = null;
    }

    byteReceived(byte) {
        switch (this.state) {
            case STATES.WAITING_FOR_START:
                if (byte === START_BYTE) {
                    this.state = STATES.WAITING_FOR_LENGTH;
                    this.frame[0] = byte;
                    this.emit('debug', 'Waiting for length');
                    this.startTimeout();
                }
                break;

            case STATES.WAITING_FOR_LENGTH:
                this.frameLength = (byte - 1) >> 2;
                this.frameLength = this.frameLength + 2;
                this.state = STATES.WAITING_FOR_LENGTH_EXTENSION;
                this.frame[1] = byte;
                this.emit('debug', 'Waiting for LengthExtension');
                this.startTimeout();
                break;

            case STATES.WAITING_FOR_LENGTH_EXTENSION:
                if ((byte & 1) === 1) {
                    this.emit('debug', "2nd length byte -> +64");
                    this.frameLength = this.frameLength + 64;
                }
                this.state = STATES.WAITING_FOR_PAYLOAD;
                this.frame[2] = byte;
                this.emit('debug', `frame has ${this.frameLength} Bytes`);
                this.frameIndex = 3;
                this.startTimeout();
                break;

            case STATES.WAITING_FOR_PAYLOAD:
                if (this.frameIndex < this.frameLength) {
                    this.frame[this.frameIndex] = byte;
                    this.frameIndex++;
                    this.startTimeout();
                } else {
                    this.stopTimeout();
                    this.processFrame();
                    this.state = STATES.WAITING_FOR_START;
                }
                break;

            // should never happen
            default:
                this.emit('warn', 'Wrong state');
                this.state = STATES.WAITING_FOR_START;
                break;
        }
    }

    start() {
        this.server = new SerialPort(this.options);

        this.server.on('error', err => {
            this.server.close()
                .then(() => this.emit('error', err));
        });

        this.server.on('open', () => this.emit('debug', `adapter opened port ${this.options.path}`));

        this.server.on('data', data => {
            /*
                byte Function
                0    Start-Byte, always 0x02
                1    Payload length. the value must be LEN % 4 = 0, Example 0x61(hex) -> 97(dez), (97 -1) divided by 4 -> 24. + Startbyte + Stopbyte = 26 Bytes in Frame
                2    always 0x20 ?
                3    always 0x82 ?
                4    Message type ?
                5    Message type ?
                6    Message type ?
                7    Target address
                8    Target address
                9    Target address
                10   Target address
                11   Source address
                12   Source address
                13   Source address
                14   Source address
                15
                16   Request counter must be identical with response counter
                17   Finger hash
                ...  ???
                n    End-Byte, always 0x03
                */
            for (let i = 0; i < data.length; i++) {
                this.byteReceived(data[i]);
            }
        });

        this.server.on('end', () => {
            this.emit('debug', `port ${this.port} closed`);
            this.emit('error', 'port closed');
        });
    }
}

module.exports = EKey;

