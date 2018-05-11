/* jshint -W097 */// jshint strict:false
/*jslint node: true */
/*jshint expr: true*/
'use strict';
const expect = require('chai').expect;
const setup  = require(__dirname + '/lib/setup');
const dgram  = require('dgram');


let objects = null;
let states  = null;
let onStateChanged = null;

let adapterShortName = setup.adapterName.substring(setup.adapterName.indexOf('.') + 1);

let sendMessage = null;

function checkConnectionOfAdapter(cb, counter) {
    counter = counter || 0;
    console.log('Try check #' + counter);
    if (counter > 30) {
        if (cb) cb('Cannot check connection');
        return;
    }

    states.getState('system.adapter.' + adapterShortName + '.0.alive', function (err, state) {
        if (err) console.error(err);
        if (state && state.val) {
            if (cb) cb();
        } else {
            setTimeout(function () {
                checkConnectionOfAdapter(cb, counter + 1);
            }, 1000);
        }
    });
}

function checkValueOfState(id, value, cb, counter) {
    counter = counter || 0;
    if (counter > 20) {
        if (cb) cb('Cannot check value Of State ' + id);
        return;
    }

    states.getState(id, function (err, state) {
        if (err) console.error(err);
        if (value === null && !state) {
            if (cb) cb();
        } else
        if (state && (value === undefined || state.val === value)) {
            if (cb) cb();
        } else {
            setTimeout(function () {
                checkValueOfState(id, value, cb, counter + 1);
            }, 500);
        }
    });
}

function onReceive(msg, info) {

}

function setupUdpServer(onReceive, onReady) {

    const server = dgram.createSocket('udp4');

    function sendMessage(message, port, address) {
        console.log(`Send "${message}" to ${address}:${port}`);
        server.send(message, 0, message.length, port, address);
    }

    server.on('error', err => {
        console.log(`server error:\n${err.stack}`);
        server.close();
    });

    server.on('message', (msg, rinfo) => {
        console.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
        onReceive && onReceive(msg, rinfo);
    });

    server.on('listening', () => {
        const address = server.address();
        console.log(`server listening ${address.address}:${address.port}`);
        onReady && onReady(sendMessage);
    });

    server.bind(56000, '127.0.0.1');
}

describe('Test ' + adapterShortName + ' adapter', function() {
    before('Test ' + adapterShortName + ' adapter: Start js-controller', function (_done) {
        this.timeout(600000); // because of first install from npm

        setup.setupController(function () {
            let config = setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';

            config.native.host   = '127.0.0.1';
            config.native.port   = 15000;
            config.native.defaultUpdateInterval   = 20;
            config.native.devices = [
                {
                    ip: '127.0.0.1',
                    protocol: 'HOME'
                }
            ];
            setup.setAdapterConfig(config.common, config.native);

            setupUdpServer(onReceive, _sendMessage => {
                sendMessage = _sendMessage;

                setup.startController(true, (id, obj) => {}, (id, state) => {
                        if (onStateChanged) onStateChanged(id, state);
                    },
                    (_objects, _states) => {
                        objects = _objects;
                        states  = _states;
                        _done();
                    });
            });
        });
    });

    it('Test ' + adapterShortName + ' adapter: Check if adapter started', done => {
        this.timeout(60000);

        checkConnectionOfAdapter(res => {
            if (res) console.log(res);
            expect(res).not.to.be.equal('Cannot check connection');
            objects.setObject('system.adapter.test.0', {
                    common: {

                    },
                    type: 'instance'
                },
                function () {
                    states.subscribeMessage('system.adapter.test.0');
                    done();
                });
        });
    });

    it('Test ' + adapterShortName + ' adapter: test HOME protocol', done => {
        this.timeout(1000);
        expect(sendMessage).to.be.ok;
        sendMessage(Buffer.from('1_0005_1_801845670767_1_1', 'ascii'), 15000, '127.0.0.1');
        checkValueOfState('ekey.0.devices.127_0_0_1.user', '0005', () => {
            checkValueOfState('ekey.0.devices.127_0_0_1.relay', '1', () => {
                done();
            });
        });
    });

    /*it('Test ' + adapterShortName + ' adapter: test Multi protocol', done => {
        this.timeout(1000);
        expect(sendMessage).to.be.ok;
        sendMessage(Buffer.from('1 0003 -----JOSEF 1 7 2 80131004120001 -GAR 1 -', 'ascii'), 15000, '127.0.0.1');
        checkValueOfState('ekey.0.devices.127_0_0_1.user', '0003', () => {
            checkValueOfState('ekey.0.devices.127_0_0_1.fs_name', '-GAR', () => {
                done();
            });
        });
    });*/

    /*it('Test ' + adapterShortName + ' adapter: test RARE protocol', done => {
        this.timeout(1000);
        expect(sendMessage).to.be.ok;
        sendMessage(Buffer.from([
            0, 0, 0, 3, // version
            0, 0, 0, 0x88, // open door with finger
            0, 0, 0, 0x10, // terminal ID
            // "0123456789:;<="
            0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, // serial (14 bytes
            1, // relay
            0, // reserved
            0, 0, 0, 67, // user id
            0, 0, 0, 5, // finger
            // "              01"
            0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x30, 0x31, // event
            //"2018-05-05 00:00"
            0x32, 0x30, 0x31, 0x38, 0x2d, 0x30, 0x35, 0x2d, 0x30, 0x35, 0x20, 0x30, 0x30, 0x3A, 0x30, 0x30, // time
            0, 5, // strName
            0, 6 // persional ID
        ]), 15000, '127.0.0.1');
        checkValueOfState('ekey.0.devices.127_0_0_1.user', 67, () => {
            checkValueOfState('ekey.0.devices.127_0_0_1.relay', 1, () => {
                done();
            });
        });
    });*/

    after('Test ' + adapterShortName + ' adapter: Stop js-controller', function (done) {
        this.timeout(10000);

        setup.stopController(function (normalTerminated) {
            console.log('Adapter normal terminated: ' + normalTerminated);
            done();
        });
    });
});
