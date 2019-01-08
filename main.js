/**
 *
 * ekey adapter bluefox <dogafox@gmail.com>
 *
 * Adapter for communication with UDP ekey converter
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
                const browse = new Buffer([0x01, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xe8, 0x23, 0x18, 0x18]);

                server.on('message', (message, rinfo) => {
                    if (message.toString('base64') !== browse.toString('base64')) {
                        if (!devices.find(dev => dev.ip === rinfo.address)) {
                            devices.push({ip: rinfo.address});
                        }
                    }
                });
                server.on('error', error => {
                    adapter.log.error(error);
                });
                server.on('listening', () => {
                    server.setBroadcast(true);
                    setImmediate(() => {
                        server.send(browse, 0, browse.length, 58009, '255.255.255.255');
                    });
                });
                server.bind(58009);

                setTimeout(() => {
                    server.close();
                    server = null;
                    adapter.sendTo(obj.from, obj.command, {result: devices}, obj.callback);
                }, 3000);
                break;
        }
    }
}

function decodeHome(ip, message) {
    const values = message.toString('ascii').split(/[;_?]/);
    if (values.length < 6) {
        adapter.log.warn(`Invalid packet length! ${values.join('_')}`);
    } else
    if (values[0] !== '1') {
        adapter.log.warn(`Invalid packet type! ${values[0]}`);
    } else {
        if (values[4] === '1') values[4] = 'OPEN';
        if (values[4] === '2') values[4] = 'REJECT';
        adapter.log.debug(`USER ID: ${values[1]}, Finger ID: ${values[2]}, Serial ID: ${values[3]}, Action: ${values[4]}, Relais: ${values[5]}`);
        const state = 'devices.' + ip.replace(/\./g, '_') + '.';
        adapter.setState(state + 'user',   values[1], true);
        adapter.setState(state + 'finger', values[2], true);
        adapter.setState(state + 'serial', values[3], true);
        adapter.setState(state + 'action', values[4], true);
        adapter.setState(state + 'relay',  values[5], true);
    }
}

function decodeMulti(ip, message) {
    const values = message.toString('ascii').split(/[;_?]/);
    if (values.length < 6) {
        adapter.log.warn(`Invalid packet length! ${values.join('_')}`);
    } else
    if (values[0] !== '1') {
        adapter.log.warn(`Invalid packet type! ${values[0]}`);
    } else {
        if (values[4] === '1') values[8] = 'OPEN';
        if (values[4] === '2') values[8] = 'REJECT';
        adapter.log.debug(`USER ID: ${values[1]}, Finger ID: ${values[4]}, Serial ID: ${values[6]}, Action: ${values[8]}, Input: ${values[9]}`);
        const state = 'devices.' + ip.replace(/\./g, '_') + '.';
        adapter.setState(state + 'user',        values[1], true);
        adapter.setState(state + 'user_name',   values[2], true);

        // 0 User is disabled
        // 1 User is enabled
        // - undefined
        adapter.setState(state + 'user_status', values[3], true);
        // 1 = left-hand little finger
        // 2 = left-hand ring finger
        //     .
        //     .
        // 0 = right-hand little finger
        //     ,-,= no finger
        adapter.setState(state + 'finger',      values[4], true);
        adapter.setState(state + 'key',         values[5], true);
        adapter.setState(state + 'serial',      values[6], true);
        adapter.setState(state + 'fs_name',     values[7], true);

        // 1 Open
        // 2 Rejection of unknown finger
        // 3 Rejection time zone A
        // 4 Rejection time zone B
        // 5 Rejection inactive
        // 6 Rejection "Only ALWAYS users"
        // 7 FS not coupled to CP
        // 8 digital input
        adapter.setState(state + 'action',      values[8], true);

        // 1 digital input 1
        // 2 digital input 2
        // 3 digital input 3
        // 4 digital input 4
        // - no digital input
        adapter.setState(state + 'input',       values[9], true);
    }
}

function decodeRare(ip, message) {
    if (message.length < 20) {
        adapter.log.warn(`Invalid packet length! ${values.join('_')}`);
        return;
    }

    let offset = 0;
    const nVersion = message.readInt32BE(offset);offset+=4;
    if (nVersion !== 3) {
        adapter.log.warn(`Invalid version length! ${nVersion} != 3`);
        return;
    }
    const state = 'devices.' + ip.replace(/\./g, '_') + '.';

    // 0x88 = decimal 136.. open door with finger
    // 0x89 = decimal 137.. poor quality or unknown finger
    const nCmd = message.readInt32BE(offset);offset += 4;
    if (nCmd !== 0x88 && nCmd !== 0x89) {
        adapter.log.warn(`Unknown command! 0x${nCmd.toString(16)}`);
        return;
    }
    // Address of finger scanner.
    const nTerminalID = message.readInt32BE(offset);offset += 4;
    const strTerminalSerial = message.toString('ascii', offset, offset + 14);offset += 14;
    // 0.. Channel 1 (Relay1)
    // 1.. Channel 2 (Relay2)
    // 2.. Channel 3 (Relay3)
    const nRelayID = message[offset];offset++;
    if (nRelayID < 0 || nRelayID > 4) {
        adapter.log.warn(`Unknown nRelayID! ${nRelayID}`);
        return;
    }

    offset++; // reserved
    const nUserID       = message.readInt32BE(offset);offset += 4;
    const nFinger       = message.readInt32BE(offset);offset += 4;
    const strEvent      = message.toString('ascii', offset, offset + 16);   offset += 16;
    const sTime         = message.toString('ascii', offset, offset + 16);   offset += 16;
    const strName       = message.readInt16BE(offset);offset += 2;
    const strPersonalID = message.readInt16BE(offset);offset += 2;

    const ts = new Date(sTime).getTime();

    adapter.setState(state + 'finger', {ack: true, ts: ts, val: nFinger});
    adapter.setState(state + 'user',   {ack: true, ts: ts, val: nUserID});
    adapter.setState(state + 'serial', {ack: true, ts: ts, val: strTerminalSerial});
    adapter.setState(state + 'action', {ack: true, ts: ts, val: nCmd === 0x88 ? 'OPEN' : 'REJECT'});
    adapter.setState(state + 'relay',  {ack: true, ts: ts, val: nRelayID});
    //nTerminalID
    adapter.log.debug(`Received info ${nCmd === 0x88 ? 'OPEN' : 'REJECT'}, finger: ${nFinger}, user: ${nUserID}, serial: "${strTerminalSerial}", relay: ${nRelayID}, strEvent: "${strEvent}", sTime: "${sTime}", strName: ${strName}, strPersonalID: ${strPersonalID}, nTerminalID: ${nTerminalID}`)
}

function tasksDeleteDevice(tasks, ip) {
    const id = adapter.namespace + '.devices.' + ip.replace(/[.\s]+/g, '_');
    tasks.push({
        type: 'delete',
        id:   id
    });
    tasks.push({
        type: 'delete',
        id:   id + '.user'
    });
    tasks.push({
        type: 'delete',
        id:   id + '.finger'
    });
    tasks.push({
        type: 'delete',
        id:   id + '.serial'
    });
    tasks.push({
        type: 'delete',
        id:   id + '.action'
    });
    tasks.push({
        type: 'delete',
        id:   id + '.relay'
    });
}

function tasksAddDevice(tasks, ip, protocol) {
    const id = adapter.namespace + '.devices.' + ip.replace(/[.\s]+/g, '_');

    tasks.push({
        type: 'add',
        obj:   {
            _id: id,
            common: {
                name: 'ekey ' + ip
            },
            type: 'channel',
            native: {
                ip: ip,
                protocol: protocol
            }
        }
    });

    tasks.push({
        type: 'add',
        obj:   {
            _id: id + '.user',
            common: {
                name: 'ekey ' + ip + ' user ID',
                write: false,
                read: true,
                type: 'string'
            },
            type: 'state',
            native: {
            }
        }
    });

    tasks.push({
        type: 'add',
        obj:   {
            _id: id + '.finger',
            common: {
                name: 'ekey ' + ip + ' finger ID',
                write: false,
                read: true,
                type: 'string'
            },
            type: 'state',
            native: {
            }
        }
    });

    tasks.push({
        type: 'add',
        obj:   {
            _id: id + '.serial',
            common: {
                name: 'ekey ' + ip + ' serial ID',
                write: false,
                read: true,
                type: 'string'
            },
            type: 'state',
            native: {
            }
        }
    });

    tasks.push({
        type: 'add',
        obj:   {
            _id: id + '.action',
            common: {
                name: 'ekey ' + ip + ' action',
                write: false,
                read: true,
                type: 'string'
            },
            type: 'state',
            native: {
            }
        }
    });

    if (protocol === 'HOME') {
        tasks.push({
            type: 'add',
            obj:   {
                _id: id + '.relay',
                common: {
                    name: 'ekey ' + ip + ' relay',
                    write: false,
                    read: true,
                    type: 'string'
                },
                type: 'state',
                native: {
                }
            }
        });
    }
    if (protocol === 'MULTI') {
        tasks.push({
            type: 'add',
            obj:   {
                _id: id + '.user_name',
                common: {
                    name: 'ekey ' + ip + ' user_name',
                    write: false,
                    read: true,
                    type: 'string'
                },
                type: 'state',
                native: {
                }
            }
        });
        tasks.push({
            type: 'add',
            obj:   {
                _id: id + '.user_status',
                common: {
                    name: 'ekey ' + ip + ' user_status',
                    write: false,
                    read: true,
                    type: 'string'
                },
                type: 'state',
                native: {
                }
            }
        });
        tasks.push({
            type: 'add',
            obj:   {
                _id: id + '.key',
                common: {
                    name: 'ekey ' + ip + ' key',
                    write: false,
                    read: true,
                    type: 'string'
                },
                type: 'state',
                native: {
                }
            }
        });
        tasks.push({
            type: 'add',
            obj:   {
                _id: id + '.fs_name',
                common: {
                    name: 'ekey ' + ip + ' fs_name',
                    write: false,
                    read: true,
                    type: 'string'
                },
                type: 'state',
                native: {
                }
            }
        });
        tasks.push({
            type: 'add',
            obj:   {
                _id: id + '.input',
                common: {
                    name: 'ekey ' + ip + ' input',
                    write: false,
                    read: true,
                    type: 'string'
                },
                type: 'state',
                native: {
                }
            }
        });
    }
}

function processTasks(tasks, callback) {
    if (!tasks || !tasks.length) {
        callback && callback();
    } else {
        let task = tasks.shift();
        switch (task.type) {
            case 'delete':
                adapter.log.debug(`Delete STATE ${task.id}`);
                adapter.delForeignState(task.id, err => {
                    if (err) adapter.log.warn(`Cannot delete state: ${err}`);
                    adapter.delForeignObject(task.id, err => {
                        if (err) adapter.log.warn(`Cannot delete object: ${err}`);
                        setImmediate(processTasks, tasks, callback);
                    });
                });
                break;
            case 'add':
            case 'update':
                adapter.log.debug(`${task.type} STATE ${task.obj._id}`);
                adapter.getForeignObject(task.obj._id, (err, obj) => {
                    if (!obj) {
                        adapter.setForeignObject(task.obj._id, task.obj, err => {
                            if (err) adapter.log.warn(`Cannot set object: ${err}`);
                            setImmediate(processTasks, tasks, callback);
                        });
                    } else {
                        obj.native = task.obj.native;
                        adapter.setForeignObject(obj._id, obj, err => {
                            if (err) adapter.log.warn(`Cannot set object: ${err}`);
                            setImmediate(processTasks, tasks, callback);
                        });
                    }
                });
                break;
            default:
                adapter.log.error(`Unknown task ${JSON.stringify(task)}`);
                setImmediate(processTasks, tasks, callback);
                break;
        }
    }
}

function syncConfig(callback) {
    adapter.getChannelsOf('devices', function (err, channels) {
        let configToDelete = [];
        let configToAdd    = [];
        let k;
        if (adapter.config.devices) {
            for (k = 0; k < adapter.config.devices.length; k++) {
                configToAdd.push(adapter.config.devices[k].ip);
                devices[adapter.config.devices[k].ip] = adapter.config.devices[k].protocol;
            }
        }
        let tasks = [];

        if (channels) {
            for (let j = 0; j < channels.length; j++) {
                let ip = channels[j].native.ip;
                if (!ip) {
                    adapter.log.warn(`No IP address found for ${JSON.stringify(channels[j])}`);
                    continue;
                }

                let pos = configToAdd.indexOf(ip);
                if (pos !== -1) {
                    configToAdd.splice(pos, 1);
                    if (channels[j].native.protocol !== devices[ip]) {
                        channels[j].native.protocol = devices[ip];
                        tasks.push({type: 'update', obj: channels[j]});
                        tasksAddDevice(tasks, channels[j].native.ip, channels[j].protocol);
                    }
                } else {
                    configToDelete.push(ip);
                }
            }
        }

        if (configToDelete.length) {
            for (let e = 0; e < configToDelete.length; e++) {
                tasksDeleteDevice(tasks, configToDelete[e]);
            }
        }

        processTasks(tasks, function () {
            let tasks = [];
            if (configToAdd.length) {
                for (let r = 0; r < adapter.config.devices.length; r++) {
                    if (configToAdd.indexOf(adapter.config.devices[r].ip) !== -1) {
                        tasksAddDevice(tasks, adapter.config.devices[r].ip, adapter.config.devices[r].protocol);
                    }
                }
            }
            processTasks(tasks, callback);
        });
    });
}

function startServer() {
    mServer = dgram.createSocket('udp4');

    mServer.on('error', err => {
        adapter.log.error(`Cannot open socket:\n${err.stack}`);
        mServer.close();
        process.exit(20);
    });
    mServer.on('listening', () => {
        const address = mServer.address();
        adapter.log.info(`adapter listening ${address.address}:${address.port}`);
    });

    mServer.on('message', (message, rinfo) => {
        if (devices[rinfo.address]) {
            if (devices[rinfo.address] === 'HOME') {
                adapter.log.debug(rinfo.address + ':' + rinfo.port + ' - ' + message.toString('ascii'));
                decodeHome(rinfo.address, message);
            } else if (devices[rinfo.address] === 'MULTI') {
                adapter.log.debug(rinfo.address + ':' + rinfo.port + ' - ' + message.toString('ascii'));
                decodeMulti(rinfo.address, message);
            } else if (devices[rinfo.address] === 'RARE') {
                // do not output rare
                adapter.log.debug(rinfo.address + ':' + rinfo.port + ' - ' + message.length + ' bytes');
                decodeRare(rinfo.address, message);
            } else {
                adapter.log.debug(rinfo.address + ':' + rinfo.port + ' - ' + message.toString('ascii'));
                adapter.log.warn(`unknown communication type for ${rinfo.address}: ${devices[rinfo.address]}`);
            }
        } else {
            adapter.log.debug(rinfo.address + ':' + rinfo.port + ' - ' + message.toString('ascii'));
        }
    });

    mServer.bind(adapter.config.port);
}

function main() {
    adapter.config.port = parseInt(adapter.config.port, 10) || 56000;

    syncConfig(startServer);
}

