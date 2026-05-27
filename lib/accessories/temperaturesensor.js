/**
 * FritzTemperatureSensorAccessory
 *
 * @url https://github.com/glowf1sh/homebridge-fritz-new
 * @original author Andreas Götz
 * @new author Glowf1sh <https://twitch.tv/glowf1sh>
 * @license MIT
 */

/* jslint node: true, laxcomma: true, esversion: 8 */
"use strict";

let Service, Characteristic, FritzPlatform, FritzAccessory;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    FritzPlatform = require('../platform')(homebridge);
    FritzAccessory = require('../accessory')(homebridge);

    class FritzTemperatureSensorAccessory extends FritzAccessory {
        constructor(platform, ain, type, device) {
            super(platform, ain, type, device);

            if (device) {
                // Existing accessory from cache
                this.accessory = device;
                this.accessory.context.ain = ain;
                this.accessory.context.type = type;
            } else {
                // New accessory
                const name = this.name;
                const uuid = this.platform.api.hap.uuid.generate(ain);
                this.accessory = new this.platform.api.platformAccessory(name, uuid);
                this.accessory.context.ain = ain;
                this.accessory.context.type = type;
            }

            // Setup AccessoryInformation service
            if (!this.accessory.getService(Service.AccessoryInformation)) {
                this.accessory.addService(Service.AccessoryInformation);
            }

            const infoService = this.accessory.getService(Service.AccessoryInformation);
            infoService.setCharacteristic(Characteristic.SerialNumber, this.ain);

            if (this.device.manufacturer) {
                infoService.setCharacteristic(Characteristic.Manufacturer, this.device.manufacturer);
            }
            if (this.device.productname) {
                infoService.setCharacteristic(Characteristic.Model, this.device.productname);
            }
            if (this.device.fwversion) {
                infoService.setCharacteristic(Characteristic.FirmwareRevision, this.device.fwversion);
            }

            // Setup TemperatureSensor service
            let tempService = this.accessory.getService(Service.TemperatureSensor);
            if (!tempService) {
                tempService = this.accessory.addService(Service.TemperatureSensor, this.name);
            }

            tempService.getCharacteristic(Characteristic.CurrentTemperature)
                .setProps({minValue: -50})
                .on('get', this.getCurrentTemperature.bind(this));

            // Store references to services for quick access
            this.services = {
                AccessoryInformation: infoService,
                TemperatureSensor: tempService
            };

            // Initialize temperature state
            this.services.TemperatureSensor.fritzCurrentTemperature = 20;

            // Setup HumiditySensor service if device supports it.
            // Fall back to context.features when device list hasn't been fetched yet
            // (i.e. during configureAccessory cache restore at startup).
            const deviceFeatures = (this.device && this.device.features) || this.accessory.context.features || {};
            const hasHumidity = !!deviceFeatures.hasHumidity;
            if (hasHumidity) {
                let humService = this.accessory.getService(Service.HumiditySensor);
                if (!humService) {
                    humService = this.accessory.addService(Service.HumiditySensor, this.name);
                }
                humService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
                    .on('get', this.getHumidity.bind(this));
                this.services.HumiditySensor = humService;
                this.services.HumiditySensor.fritzCurrentHumidity = 0;
                this.platform.log.debug(`Temperature sensor ${ain} has humidity support`);
            } else {
                // Remove stale humidity service from cache if device no longer reports it
                const staleHumService = this.accessory.getService(Service.HumiditySensor);
                if (staleHumService) {
                    this.accessory.removeService(staleHumService);
                }
            }

            this.pollInterval = this.platform.interval;
            this.startPolling();
        }

        // Override getServices to work with dynamic platform
        getServices() {
            return [];
        }

        // Called by the platform after device discovery to add/remove services
        // that depend on device capabilities. Safe to call on cached accessories
        // that were set up before the device list was available.
        updateServices(device) {
            this.device = device;
            const hasHumidity = !!(device && device.features && device.features.hasHumidity);

            if (hasHumidity && !this.services.HumiditySensor) {
                let humService = this.accessory.getService(Service.HumiditySensor);
                if (!humService) {
                    humService = this.accessory.addService(Service.HumiditySensor, this.name);
                }
                humService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
                    .on('get', this.getHumidity.bind(this));
                this.services.HumiditySensor = humService;
                this.services.HumiditySensor.fritzCurrentHumidity = 0;
                this.platform.log(`[${this.name}] Added HumiditySensor service`);
            } else if (!hasHumidity && this.services.HumiditySensor) {
                this.accessory.removeService(this.services.HumiditySensor);
                delete this.services.HumiditySensor;
                this.platform.log(`[${this.name}] Removed HumiditySensor service (device no longer reports humidity)`);
            }
        }

        update() {
            this.platform.log.debug(`Updating ${this.type} ${this.ain}`);
            this.queryCurrentTemperature();
            if (this.services.HumiditySensor) {
                this.queryHumidity();
            }
        }

        getHumidity(callback) {
            this.platform.log.debug(`Getting ${this.type} ${this.ain} humidity`);
            callback(null, this.services.HumiditySensor.fritzCurrentHumidity);
            this.queryHumidity();
        }

        queryHumidity() {
            if (!this.services.HumiditySensor) return;

            this.platform.fritz('getHumidity', this.ain).then(humidity => {
                if (humidity === null || humidity === undefined) return;
                const service = this.services.HumiditySensor;
                service.fritzCurrentHumidity = humidity;
                service.getCharacteristic(Characteristic.CurrentRelativeHumidity).updateValue(humidity);
            }).catch(err => {
                this.platform.log.debug(`Failed to query humidity for ${this.ain}:`, err.message);
            });
        }

        startPolling() {
            const poll = async () => {
                await this.update();
                this.pollTimeout = setTimeout(poll, this.pollInterval);
            };

            poll();
        }

        cleanup() {
            if (this.pollTimeout) {
                clearTimeout(this.pollTimeout);
                this.pollTimeout = null;
            }
        }
    }

    return FritzTemperatureSensorAccessory;
};
