/**
 *
 * ekey adapter
 *
 * Adapter for communication with UDP ekey converter
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2018-2022 ioBroker <dogafox@gmail.com>
 *
 */
/* jshint -W097 */
/* jshint strict: true */
/* jslint node: true */
/* jslint esversion: 6 */

'use strict';

const utils       = require('@iobroker/adapter-core'); // Get common adapter utils
const dgram       = require('dgram');
const adapterName = require('./package.json').name.split('.').pop();
let   devices     = {};
let   UdpServer   = require('./lib/udp');
let   SerialServer= require('./lib/serial');
let   timeout     = null;
let   mServer     = null;
let   sServer     = null;
/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;

const NET_ACTIONS = {
    '0': 'ActionCodeNone',
    '1': 'ActionCodeEnter',
    '2': 'ActionCodeLeave',
    '3': 'ActionCodeRefused',
    '4': 'ActionCodeUnrecognized',
    '5': 'ActionCodeAlarmDevOn',
    '6': 'ActionCodeAlarmDevOff',
    '15': 'ActionCodeReboot',
};

const NET_EVENTS = {
    '1': 'Switch relay 1 with day switching',
    '2': 'Relay 1 permanently on with day switching',
    '3': 'Relay 1 permanently off',
    '4': 'Relay 2 permanently on with day switching, LED on',
    '5': 'Relay 2 permanently off, LED off',
    '6': 'Relay 3 permanently on',
    '7': 'Relay 4 permanently on',
    '8': 'Switch relay 2',
    '9': 'Switch relay 3',
    '10': 'Switch relay 4',
    '15': 'Toggle relay 1',
    '16': 'Toggle relay 2',
    '17': 'Toggle relay 3',
    '18': 'Toggle relay 4',
    '19': 'Denied: unknown',
    '20': 'Denied: known',
    '21': 'Switch local relay 1 with day switching',
    '23': 'Local relay 1 permanently on with day switching',
    '24': 'Local relay 1 permanently off',
    '25': 'Toggle local relay 1',
    '54': 'Relay 3 permanently off',
    '55': 'Relay 4 permanently off',
    '56': 'Relay 1 permanently on with day switching',
    '57': 'Relay 2 permanently on with day switching',
    '58': 'Relay 3 permanently on with day switching',
    '59': 'Relay 4 permanently on with day switching',
};

/**
 * Starts the adapter instance
 * @param {Partial<ioBroker.AdapterOptions>} [options]
 */
function startAdapter(options) {
    adapter = utils.adapter(Object.assign({}, options, {name: adapterName}));

    adapter.on('unload', callback => onClose(callback));

    adapter.on('ready', main);

    adapter.on('message', processMessage);

    return adapter;
}

function onClose(callback) {
    timeout && clearTimeout(timeout);
    timeout = null;

    if (mServer) {
        mServer.close();
        mServer = null;
    }

    if (sServer) {
        sServer.close()
            .then(() => callback && callback());
        sServer = null;
    } else {
        callback && callback();
    }
}

process.on('SIGINT', () => onClose());

process.on('uncaughtException', err => {
    adapter && adapter.log && adapter.log.warn(`Exception: ${err}`);
    onClose();
});

function processMessage(obj) {
    if (!obj) {
        return;
    }

    if (obj) {
        switch (obj.command) {
            case 'browse':
                let server = dgram.createSocket('udp4');
                let devices = (obj.message && obj.message.devices) || [];
                if (typeof devices === 'string') {
                    try {
                        devices = JSON.parse(devices);
                    } catch (e) {
                        adapter.log.error(`Cannot parse devices: ${e}`);
                        devices = [];
                    }
                }
                const browse = new Buffer([0x01, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xe8, 0x23, 0x18, 0x18]);

                server.on('message', (message, rinfo) => {
                    if (message.toString('base64') !== browse.toString('base64')) {
                        if (!devices.find(dev => dev.ip === rinfo.address)) {
                            devices.push({ip: rinfo.address});
                        }
                    }
                });
                server.on('error', error => adapter.log.error(error));
                server.on('listening', () => {
                    server.setBroadcast(true);
                    setImmediate(() => server.send(browse, 0, browse.length, 58009, '255.255.255.255'));
                });
                server.bind(58009);

                timeout = setTimeout(() => {
                    timeout = null;
                    server.close();
                    server = null;
                    devices.push({ip: 'hallo'});
                    adapter.sendTo(obj.from, obj.command, {native: {devices}}, obj.callback);
                }, 3000);
                break;

            case 'listPorts':
                if (obj.callback) {
                    try {
                        const { SerialPort } = require('serialport');
                        if (SerialPort) {
                            // read all found serial ports
                            SerialPort.list()
                                .then(ports => {
                                    adapter.log.info(`List of port: ${JSON.stringify(ports)}`);
                                    adapter.sendTo(obj.from, obj.command, ports.map(item => ({label: item.path, value: item.path})), obj.callback);
                                })
                                .catch(e => {
                                    adapter.sendTo(obj.from, obj.command, [], obj.callback);
                                    adapter.log.error(e)
                                });
                        } else {
                            adapter.log.warn('Module serialport is not available');
                            adapter.sendTo(obj.from, obj.command, [{label: 'Not available', value: ''}], obj.callback);
                        }
                    } catch (e) {
                        adapter.sendTo(obj.from, obj.command, [{label: 'Not available', value: ''}], obj.callback);
                    }
                }

                break;
        }
    }
}

function decodeHome(ip, message) {
    //     0    1       2       3         4       5
    const [one, userId, finger, serialId, action, relay] = message.toString('ascii').split(/[;_?]/);
    if (relay === undefined) {
        adapter.log.warn(`Invalid packet length! ${message.toString('ascii')}`);
    } else
    if (one !== '1') {
        adapter.log.warn(`Invalid packet type! ${one}`);
    } else {
        adapter.log.debug(`USER ID: ${userId}, Finger ID: ${finger}, Serial ID: ${serialId}, Action: ${action === '1' ? 'OPEN' : (action === '2' ? 'REJECT' : action)}, Relais: ${relay}`);
        const state = `devices.${ip.replace(/\./g, '_')}.`;
        adapter.setState(`${state}user`,   userId, true);
        adapter.setState(`${state}finger`, finger, true);
        adapter.setState(`${state}serial`, serialId, true);
        adapter.setState(`${state}action`, action === '1' ? 'OPEN' : (action === '2' ? 'REJECT' : action), true);
        adapter.setState(`${state}relay`,  relay, true);
    }
}

function decodeMulti(ip, message) {
    //     0    1       2         3           4       5    6         7       8       9
    const [one, userId, userName, userStatus, finger, key, serialId, fsName, action, input] = message.toString('ascii').split(/[;_?]/);
    if (serialId === undefined) {
        adapter.log.warn(`Invalid packet length! ${message.toString('ascii')}`);
    } else
    if (one !== '1') {
        adapter.log.warn(`Invalid packet type! ${one}`);
    } else {
        adapter.log.debug(`USER ID: ${userId}, Finger ID: ${finger}, Serial ID: ${serialId}, Action: ${action}, Input: ${input}`);
        const state = `devices.${ip.replace(/\./g, '_')}.`;
        adapter.setState(`${state}user`,        userId, true);
        adapter.setState(`${state}user_name`,   userName, true);

        // 0 User is disabled
        // 1 User is enabled
        // - undefined
        adapter.setState(`${state}user_status`, userStatus, true);
        // 1 = left-hand little finger
        // 2 = left-hand ring finger
        //     .
        //     .
        // 0 = right-hand little finger
        //     ,-,= no finger
        adapter.setState(`${state}finger`,      finger, true);
        adapter.setState(`${state}key`,         key, true);
        adapter.setState(`${state}serial`,      serialId, true);
        adapter.setState(`${state}fs_name`,     fsName, true);

        // 1 Open
        // 2 Rejection of unknown finger
        // 3 Rejection time zone A
        // 4 Rejection time zone B
        // 5 Rejection inactive
        // 6 Rejection "Only ALWAYS users"
        // 7 FS not coupled to CP
        // 8 digital input
        adapter.setState(`${state}action`,      action, true);

        // 1 digital input 1
        // 2 digital input 2
        // 3 digital input 3
        // 4 digital input 4
        // - no digital input
        adapter.setState(`${state}input`,       input, true);
    }
}

function decodeRare(ip, message) {
    if (message.length < 20) {
        adapter.log.warn(`Invalid packet length! ${values.join('_')}`);
        return;
    }

    let offset = 0;
    const nVersion = message.readInt32BE(offset);
    offset += 4;

    if (nVersion !== 3) {
        adapter.log.warn(`Invalid version length! ${nVersion} != 3`);
        return;
    }
    const state = `devices.${ip.replace(/\./g, '_')}.`;

    // 0x88 = decimal 136, open door with finger
    // 0x89 = decimal 137, poor quality or unknown finger
    const nCmd = message.readInt32BE(offset);
    offset += 4;

    if (nCmd !== 0x88 && nCmd !== 0x89) {
        adapter.log.warn(`Unknown command! 0x${nCmd.toString(16)}`);
    }
    // Address of finger scanner.
    const nTerminalID = message.readInt32BE(offset);
    offset += 4;

    const strTerminalSerial = message.toString('ascii', offset, offset + 14);
    offset += 14;

    // 0.. Channel 1 (Relay1)
    // 1.. Channel 2 (Relay2)
    // 2.. Channel 3 (Relay3)
    const nRelayID = message[offset];
    offset++;

    if (nRelayID < 0 || nRelayID > 4) {
        adapter.log.warn(`Unknown nRelayID! ${nRelayID}`);
        return;
    }

    offset++; // reserved
    const nUserID       = message.readInt32BE(offset);
    offset += 4;

    const nFinger       = message.readInt32BE(offset);
    offset += 4;

    const strEvent      = message.toString('ascii', offset, offset + 16);
    offset += 16;

    const sTime         = message.toString('ascii', offset, offset + 16);
    offset += 16;

    const strName       = message.readInt16BE(offset);
    offset += 2;

    const strPersonalID = message.readInt16BE(offset);
    // offset += 2;

    const ts = new Date(sTime).getTime();

    const sCmd = nCmd === 0x88 ? 'OPEN' : (nCmd === 0x89 ? 'REJECT' : ('0x' + nCmd.toString('hex')));
    adapter.setState(`${state}finger`, {ack: true, ts, val: nFinger.toString()});
    adapter.setState(`${state}user`,   {ack: true, ts, val: nUserID.toString()});
    adapter.setState(`${state}serial`, {ack: true, ts, val: strTerminalSerial});
    adapter.setState(`${state}action`, {ack: true, ts, val: sCmd});
    adapter.setState(`${state}relay`,  {ack: true, ts, val: nRelayID.toString()});
    //nTerminalID
    adapter.log.debug(`Received info ${sCmd}, finger: ${nFinger}, user: ${nUserID}, serial: "${strTerminalSerial}", relay: ${nRelayID}, strEvent: "${strEvent}", sTime: "${sTime}", strName: ${strName}, strPersonalID: ${strPersonalID}, nTerminalID: ${nTerminalID}`)
}

function decodeNet(ip, message) {
    // 03000000130000003f0c9954383030303030303030303030303000000000000000000000303030303030303030303030303030303230323231313232203130313134330000000000
    if (message.length < 20) {
        adapter.log.warn(`Invalid packet length! ${values.join('_')}`);
        return;
    }

    let offset = 0;
    const nVersion = message.readInt32BE(offset);
    offset += 4;

    if (nVersion !== 3) {
        adapter.log.warn(`Invalid version length! ${nVersion} != 3`);
        return;
    }
    const state = `devices.${ip.replace(/\./g, '_')}.`;

    // 0x88 = decimal 136, open door with finger
    // 0x89 = decimal 137, poor quality or unknown finger
    const actionCode = message.readInt32BE(offset);
    offset += 4;

    if (NET_ACTIONS[actionCode] === undefined) {
        adapter.log.debug(`Unknown command! ${actionCode.toString()}`);
    }
    if (NET_EVENTS[actionCode]) {
        adapter.log.debug(`May be it is ${actionCode.toString()}: ${NET_EVENTS[actionCode]}`);
    }

    // Address of finger scanner.
    const nTerminalID = message.readInt32BE(offset);
    offset += 4;

    const strTerminalSerial = message.toString('ascii', offset, offset + 14);
    offset += 14;

    // 0.. Channel 1 (Relay1)
    // 1.. Channel 2 (Relay2)
    // 2.. Channel 3 (Relay3)
    const nRelayID = message[offset];
    offset++;

    if (nRelayID < 0 || nRelayID > 4) {
        adapter.log.warn(`Unknown nRelayID! ${nRelayID}`);
    }

    offset++; // reserved
    const nUserID       = message.readInt32BE(offset);
    offset += 4;

    const nFinger       = message.readInt32BE(offset);
    offset += 4;

    const strEvent      = message.toString('ascii', offset, offset + 16);
    offset += 16;

    const sTime         = message.toString('ascii', offset, offset + 16);
    offset += 16;

    const strName       = message.readInt16BE(offset);
    offset += 2;

    const strPersonalID = message.readInt16BE(offset);
    // offset += 2;

    const ts = new Date(sTime).getTime();

    adapter.setState(`${state}finger`, {ack: true, ts, val: nFinger.toString()});
    adapter.setState(`${state}user`,   {ack: true, ts, val: nUserID.toString()});
    adapter.setState(`${state}serial`, {ack: true, ts, val: strTerminalSerial});
    adapter.setState(`${state}action`, {ack: true, ts, val: actionCode.toString()});
    adapter.setState(`${state}relay`,  {ack: true, ts, val: nRelayID.toString()});
    // nTerminalID
    adapter.log.debug(`Received info ${actionCode.toString()}, finger: ${nFinger}, user: ${nUserID}, serial: "${strTerminalSerial}", relay: ${nRelayID}, strEvent: "${strEvent}", sTime: "${sTime}", strName: ${strName}, strPersonalID: ${strPersonalID}, nTerminalID: ${nTerminalID}`)
}

function tasksDeleteDevice(tasks, ip) {
    const id = `${adapter.namespace}.devices.${ip.replace(/[.\s]+/g, '_')}`;
    tasks.push({
        type: 'delete',
        id
    });
    tasks.push({
        type: 'delete',
        id:   `${id}.user`
    });
    tasks.push({
        type: 'delete',
        id:   `${id}.finger`
    });
    tasks.push({
        type: 'delete',
        id:   `${id}.serial`
    });
    tasks.push({
        type: 'delete',
        id:   `${id}.action`
    });
    tasks.push({
        type: 'delete',
        id:   `${id}.relay`
    });
}

function tasksAddDevice(tasks, ip, protocol) {
    const _id = `${adapter.namespace}.devices.${ip.replace(/[.\s]+/g, '_')}`;

    tasks.push({
        type: 'add',
        obj:   {
            _id,
            common: {
                name: `ekey ${ip}`
            },
            type: 'channel',
            native: {
                ip,
                protocol,
            }
        }
    });

    if (protocol !== 'serial') {
        tasks.push({
            type: 'add',
            obj: {
                _id: `${_id}.user`,
                common: {
                    name: `ekey ${ip} user ID`,
                    write: false,
                    read: true,
                    type: 'string'
                },
                type: 'state',
                native: {}
            }
        });
    } else {
        tasks.push({
            type: 'add',
            obj: {
                _id: `${_id}.rawData`,
                common: {
                    name: `serial raw data`,
                    write: false,
                    read: true,
                    type: 'string'
                },
                type: 'state',
                native: {}
            }
        });
    }

    tasks.push({
        type: 'add',
        obj:   {
            _id: `${_id}.finger`,
            common: {
                name: `ekey ${ip} finger ID`,
                write: false,
                read: true,
                type: 'string'
            },
            type: 'state',
            native: {
            }
        }
    });

    if (protocol === 'serial') {
        return;
    }

    tasks.push({
        type: 'add',
        obj:   {
            _id: `${_id}.serial`,
            common: {
                name: `ekey ${ip} serial ID`,
                write: false,
                read: true,
                type: 'string'
            },
            type: 'state',
            native: {}
        }
    });

    tasks.push({
        type: 'add',
        obj:   {
            _id: `${_id}.action`,
            common: {
                name: `ekey ${ip} action`,
                write: false,
                read: true,
                type: 'string'
            },
            type: 'state',
            native: {}
        }
    });

    if (protocol === 'HOME') {
        tasks.push({
            type: 'add',
            obj:   {
                _id: `${_id}.relay`,
                common: {
                    name: `ekey ${ip} relay`,
                    write: false,
                    read: true,
                    type: 'string'
                },
                type: 'state',
                native: {}
            }
        });
    }
    if (protocol === 'MULTI') {
        tasks.push({
            type: 'add',
            obj:   {
                _id: `${_id}.user_name`,
                common: {
                    name: `ekey ${ip} user_name`,
                    write: false,
                    read: true,
                    type: 'string'
                },
                type: 'state',
                native: {}
            }
        });
        tasks.push({
            type: 'add',
            obj:   {
                _id: `${_id}.user_status`,
                common: {
                    name: `ekey ${ip} user_status`,
                    write: false,
                    read: true,
                    type: 'string',
                    states: {
                        '-1': 'undefined',
                        '1': 'enabled',
                        '0': 'disabled',
                    }
                },
                type: 'state',
                native: {}
            }
        });
        tasks.push({
            type: 'add',
            obj:   {
                _id: `${_id}.key`,
                common: {
                    name: `ekey ${ip} key`,
                    write: false,
                    read: true,
                    type: 'string'
                },
                type: 'state',
                native: {}
            }
        });
        tasks.push({
            type: 'add',
            obj:   {
                _id: `${_id}.fs_name`,
                common: {
                    name: `ekey ${ip} fs_name`,
                    write: false,
                    read: true,
                    type: 'string'
                },
                type: 'state',
                native: {}
            }
        });
        tasks.push({
            type: 'add',
            obj:   {
                _id: `${_id}.input`,
                common: {
                    name: `ekey ${ip} input`,
                    write: false,
                    read: true,
                    type: 'string'
                },
                type: 'state',
                native: {}
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
                    err && adapter.log.warn(`Cannot delete state: ${err}`);
                    adapter.delForeignObject(task.id, err => {
                        err && adapter.log.warn(`Cannot delete object: ${err}`);
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
                            err && adapter.log.warn(`Cannot set object: ${err}`);
                            setImmediate(processTasks, tasks, callback);
                        });
                    } else {
                        obj.native = task.obj.native;
                        adapter.setForeignObject(obj._id, obj, err => {
                            err && adapter.log.warn(`Cannot set object: ${err}`);
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
    adapter.getChannelsOf('devices', (err, channels) => {
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
                if (ip === 'serial') {
                    continue;
                }
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

        if (adapter.config.serialEnabled) {
            if (!channels.find(obj => obj._id === `${adapter.namespace}.serial`)) {
                tasksAddDevice(tasks, 'serial', 'serial');
            }
        } else {
            if (channels.find(obj => obj._id === `${adapter.namespace}.serial`)) {
                tasksDeleteDevice(tasks, 'serial');
            }
        }

        processTasks(tasks, () => {
            let tasks = [];
            if (configToAdd.length) {
                for (let r = 0; r < adapter.config.devices.length; r++) {
                    if (configToAdd.includes(adapter.config.devices[r].ip)) {
                        tasksAddDevice(tasks, adapter.config.devices[r].ip, adapter.config.devices[r].protocol);
                    }
                }
            }
            processTasks(tasks, callback);
        });
    });
}

function startServer() {
    if (adapter.config.devices.find(device => !device.serial)) {
        mServer = new UdpServer(adapter.config.port);
        mServer.on('data', (ip, port, data) => {
            if (devices[ip]) {
                if (devices[ip] === 'HOME') {
                    adapter.log.debug(`${ip}:${port} - ${data.toString('ascii')}`);
                    decodeHome(ip, data);
                } else if (devices[ip] === 'MULTI') {
                    adapter.log.debug(`${ip}:${port} - ${data.toString('ascii')}`);
                    decodeMulti(ip, data);
                } else if (devices[ip] === 'RARE') {
                    // do not output rare
                    adapter.log.debug(`${ip}:${port} - ${data.length} bytes`);
                    decodeRare(ip, data);
                } else if (devices[ip] === 'NET') {
                    // do not output net
                    adapter.log.debug(`${ip}:${port} - ${data.toString('hex')}`);
                    decodeNet(ip, data);
                } else {
                    adapter.log.debug(`${ip}:${port} - ${data.toString('ascii')}`);
                    adapter.log.warn(`unknown communication type for ${ip}: ${devices[ip]}`);
                }
            } else {
                adapter.log.debug(`${ip}:${port} - ${data.toString('ascii')}`);
            }
        });

        mServer.on('error', err => {
            adapter.log.error(`Cannot open socket:\n${err.stack}`);
            process.exit(20);
        });

        mServer.on('debug', message => adapter.log.info(message));
        mServer.start();
    }
    const serial = adapter.config.devices.find(device => device.serial);
    if (serial) {
        sServer = new SerialServer(
            adapter.config.serialPortName,
            adapter.config.serialBaudrate,
            adapter.config.serialDatabits,
            adapter.config.serialParity,
            adapter.config.serialStopbits,
            adapter.config.serialFlowcontrol,
            adapter.config.serialTimeout,
        );

        sServer.on('data', (data) => {
            adapter.setState(`serial.rawData`, data.toString('hex'), true);
        });
        sServer.on('finger', finger => {
            adapter.setState(`serial.finger`, finger, true);
        });

        sServer.on('error', err => {
            adapter.log.error(`Error on serial port: ${err.toString()}`);
            process.exit(20);
        });

        sServer.on('debug', message => adapter.log.debug(message));
        sServer.on('info', message => adapter.log.info(message));
        sServer.on('warn', message => adapter.log.warn(message));
        sServer.start();
    }
}

function main() {
    adapter.config.port = parseInt(adapter.config.port, 10) || 56000;

    syncConfig(startServer);
}

if (module.parent) {
    // Export startAdapter in compact mode
    module.exports = startAdapter;
} else {
    // otherwise start the instance directly
    startAdapter();
}