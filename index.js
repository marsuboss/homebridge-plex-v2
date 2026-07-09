'use strict';

const http = require('http');
const https = require('https');

let Service;
let Characteristic;

class Plex {
  constructor(log, config) {
    this.log = log;
    this.name = config.name;
    this.plexToken = config.plex_token;
    this.host = config.host || 'localhost';
    this.port = config.port || '32400';
    this.secure = config.secure || false;
    this.certVerification = config.cert_verification || config.certVerification || false;
    this.filter = config.filter || [];
    this.pollingInterval = config.polling_interval * 1000 || 3000;
    this.debug = config.debug || false;
    this.service = new Service.OccupancySensor(this.name);
    this.playing = false;

    if (this.debug) {
      this.log('Getting initialized...');
    }

    this.service
      .getCharacteristic(Characteristic.OccupancyDetected)
      .onGet(() => this.playing);

    this.poll();
  }

  poll() {
    this.getState()
      .then(playing => {
        this.service
          .getCharacteristic(Characteristic.OccupancyDetected)
          .updateValue(playing);
      })
      .catch(error => {
        this.log(error && error.message);
      })
      .then(() => {
        setTimeout(() => this.poll(), this.pollingInterval);
      });
  }

  fetchSessions() {
    return new Promise((resolve, reject) => {
      const client = this.secure ? https : http;
      const req = client.request({
        host: this.host,
        port: this.port,
        path: '/status/sessions',
        rejectUnauthorized: this.certVerification,
        headers: {
          'Accept': 'application/json',
          'X-Plex-Token': this.plexToken
        }
      }, res => {
        let body = '';

        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Plex server responded with status code ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  async getState() {
    if (this.debug) {
      this.log('Getting current state...');
    }

    const data = (await this.fetchSessions()).MediaContainer;
    let playing = false;

    if (data.size === 0) {
      if (this.debug) {
        this.log('No active sessions on your server. Plex is not playing.');
      }

      this.playing = false;
      return false;
    }

    if (this.debug && data.size === 1) {
      this.log('There is one active session:');
    } else if (this.debug && data.size > 1) {
      this.log('There are %s active sessions:', data.size);
    }

    data.Metadata.forEach(e => {
      const player = e.Player.title;
      const user = e.User.title;
      const state = e.Player.state;
      const stateMatch = state === 'playing';
      let rulesMatch = true;

      if (stateMatch && player) {
        rulesMatch = false;
        this.filter.forEach(rule => {
          if (this.debug) {
            this.log(`'${rule.player}' vs '${player}'`);
            this.log(`'${rule.user}' vs '${user}'`);
          }
          let playerMatch = !rule.player || rule.player.indexOf(player) > -1;
          let userMatch = !rule.user || rule.user.indexOf(user) > -1;
          rulesMatch = rulesMatch || playerMatch && userMatch;
        });
      }

      if (this.debug) {
        this.log('→ %s [%s]: %s%s', user, player, state, rulesMatch ? '' : ' (ignored)');
      }

      playing = playing || stateMatch && rulesMatch;

      if (this.debug || this.playing !== playing) {
        this.log('Plex is %splaying.', playing ? '' : 'not ');
      }
    });

    this.playing = playing;
    return playing;
  }

  getServices() {
    return [this.service];
  }
}

module.exports = homebridge => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory('homebridge-plex-v2', 'Plex', Plex);
};
