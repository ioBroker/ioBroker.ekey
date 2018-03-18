/**
 *
 * ekey adapter bluefox <dogafox@gmail.com>
 *
 * Adapter loading data from an M-Bus devices
 *
 */
/* jshint -W097 */
/* jshint strict:true */
/* jslint node: true */
/* jslint esversion: 6 */

'use strict';

const utils   = require('./lib/utils'); // Get common adapter utils
const adapter = new utils.Adapter('ekey');
const dgram   = require('dgram');
let   devices = {};
let   mServer = null;

adapter.on('ready', main);

adapter.on('message', processMessage);

function onClose(callback) {
    for (var device in devices) {
        if (devices.hasOwnProperty(device) && devices[device] && devices[device].socket) {
            devices[device].socket.close();
            devices[device].socket = null;
        }
    }

    if (mServer) {
        mServer.close();
        mServer = null;
    }


    if (callback) {
        callback();
    }
}

adapter.on('unload', function (callback) {
    onClose(callback);
});

process.on('SIGINT', function () {
    onClose();
});

process.on('uncaughtException', function (err) {
    if (adapter && adapter.log) {
        adapter.log.warn('Exception: ' + err);
    }
    onClose();
});
function processMessage(obj) {
    if (!obj) return;

    if (obj) {
        switch (obj.command) {
            case 'browse':
                let server = dgram.createSocket('udp4');
                let devices = [];
                
                server.on('message', function (message, rinfo) {
                    devices.push({ip: rinfo.address});
                });
                
                server.bind(58009, () => {
                    server.setBroadcast(true);
                    setImmediate(() => {
                        const browse = new Buffer([0x01, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xe8, 0x23, 0x18, 0x18]);
                        server.send(browse, 0, browse.length, 58009, '255.255.255.255');
                    })
                }, 0);

                setTimeout(() => {
                    server.close();
                    server = null;
                    adapter.sendTo(obj.from, obj.command, {result: devices}, obj.callback);
                }, 3000);
                break;
        }
    }
}

function decodeHome(device, values) {
    if (values.length < 6) {
        adapter.log.warn(`Invalid packet length! ${values.join('_')}`);
    } else
    if (values[0] !== '1') {
        adapter.log.warn(`Invalid packet type! ${values[0]}`);
    } else {
        if (values[4] === '1') values[4] = 'OPEN';
        if (values[4] === '2') values[4] = 'REJECT';
        adapter.log.debug(`USER ID: ${values[1]}, Finger ID: ${values[2]}, Serial ID: ${values[3]}, Action: ${values[4]}, Relais: ${values[5]}`);
        const state = device.native.ip + '.';
        adapter.setState(state + 'user_id',   values[1], true);
        adapter.setState(state + 'finger_id', values[2], true);
        adapter.setState(state + 'serial_id', values[3], true);
        adapter.setState(state + 'action',    values[4], true);
        adapter.setState(state + 'relais',    values[5], true);
    }
}

function main() {
    // read list



    adapter.config.port = parseInt(adapter.config.port, 10) || 56000;

    mServer = dgram.createSocket('udp4');

    mServer.on('message', function (message, rinfo) {
        adapter.log.debug.log(rinfo.address + ':' + rinfo.port +' - ' + message.toString('ascii'));
        if (devices[rinfo.address]) {
            const values = message.toString('ascii').split('_');
            if (devices[rinfo.address].native.type === 'HOME') {
                decodeHome(devices[rinfo.address], values);
            } else if (devices[rinfo.address].native.type === 'MULTI') {
                decodeMulti(devices[rinfo.address], values);
            } else if (devices[rinfo.address].native.type === 'RARE') {
                decodeRare(devices[rinfo.address], values);
            } else {
                adapter.log.warn(`unknown communication type for ${rinfo.address}: ${devices[rinfo.address].native.type}`);
            }
        }
    });

    mServer.bind(adapter.config.port);
}

