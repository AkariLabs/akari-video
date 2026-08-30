'use strict';

const { app } = require('electron');
const { resolve } = require('node:path');

app.commandLine.appendSwitch('disable-accelerated-video-decode');
app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();
require(resolve(__dirname, 'gop-tail-seek-main.cjs'));
