import { BaseController, ControllerGenerator, ICustomProtoDevice, IDeviceAPI } from 'magichome-platform';
import { IAccessoryState, MagicHomeAccessory } from './misc/types';
import {
	API,
	HAP,
	PlatformConfig,
} from 'homebridge';

import { _ } from 'lodash';
import { homekitInterface } from './misc/types';

const PLATFORM_NAME = 'homebridge-magichome-dynamic-platform';
const PLUGIN_NAME = 'homebridge-magichome-dynamic-platform';

export class AccessoryGenerator {

	public readonly accessoriesFromDiskMap: Map<string, MagicHomeAccessory> = new Map();
	public readonly activeAccessoriesMap: Map<string, MagicHomeAccessory> = new Map();
	private hap: HAP;
	private api: API;
	private log;
	private config: PlatformConfig;
	private controllerGenerator: ControllerGenerator;

	constructor(api, log, config, accessoriesFromDiskMap, controllerGenerator) {
		this.api = api;
		this.hap = api.hap;
		this.log = log;
		this.config = config;
		this.accessoriesFromDiskMap = accessoriesFromDiskMap;
		this.controllerGenerator = controllerGenerator;
	}

	public async generateAccessories() {
		this.log.info('Scanning network for MagicHome accessories.');
		return await this.controllerGenerator.discoverControllers().then(async controllers => {
			const accessories = this.discoverAccessories(controllers);
			this.registerOfflineAccessories(this.accessoriesFromDiskMap);

			return accessories;

		}).catch(error => {
			this.log.error(error);
		});
	}

	/**
	 * 
	 * 1. iterate through scanned controllers
	 * 	a. exist already as a homebridge accessory?
	 * 		i. yes: 
	 * 			1. check if it's allowed, if not, skip+remove
	 * 			2. check it for inconsistencies and fix
	 * 			3. register it with homekit again and reset the "last seen" to 0
	 * 			4. remove it from the diskMap so we later know that it was seen
	 * 		ii. no: 
	 * 			1. check if it's allowed, if not, skip
	 * 			2. create a new accessory Object and new homeKit interface
	 * 			3. register it with homekit and set "last seen" to 0
	 * 2. iterate through all remaining disk devices not yet removed by our scan function
	 * 	a. is it allowed, less than allocated number of restarts ( maybe add this to isAllowed)... if not, skip+remove
	 * 	b. warn user about device
	 * 	c. increment number of times unseen
	 * 	d. register with homekit again
	 * 	e. add new homeKit interface
	 * 
	 * note: need a way to just do a base protodevice scan on concurrent scans because current method creates new objects
	 * 				which is quite wasteful...
	 */

	public async rescanAccessories() {
		this.log.trace('Re-scanning network for MagicHome accessories.');
		return await this.controllerGenerator.discoverControllers().then(async controllers => {
			await this.reDiscoverAccessories(controllers);
		}).catch(error => {
			this.log.error(error);
		});
	}

	reDiscoverAccessories(controllers: Map<string, BaseController>) {

		const newAccessoriesList: MagicHomeAccessory[] = [];
		const existingAccessoriesList: MagicHomeAccessory[] = [];
		let accessory;
		for (const [uniqueId, controller] of Object.entries(controllers)) {
			// this.log.warn(controller);

			const homebridgeUUID = this.hap.uuid.generate(uniqueId);

			if (this.accessoriesFromDiskMap.has(homebridgeUUID)) {
				const existingAccessory = this.accessoriesFromDiskMap.get(homebridgeUUID);
				accessory = this.processExistingAccessory(controller, existingAccessory);

				this.accessoriesFromDiskMap.delete(homebridgeUUID);

				existingAccessoriesList.push(accessory);
				this.log.info('Found previously unreachable existing accessory. Updating...');

			} else if (!this.activeAccessoriesMap.has(homebridgeUUID)) {
				accessory = this.createNewAccessory(controller, homebridgeUUID);
				newAccessoriesList.push(accessory);				//add it to new accessory list
				//this.log.printDeviceInfo('Registering new accessory...!', newAccessory);
				this.log.info('Found previously unseen accessory during a re-scan. Registering...');
			}

			this.activeAccessoriesMap.set(homebridgeUUID, accessory);
		}

		this.registerNewAccessories(newAccessoriesList);	//register new accessories from scan
		this.updateExistingAccessories(existingAccessoriesList);
	}

	discoverAccessories(controllers: Map<string, BaseController>) {

		const newAccessoriesList: MagicHomeAccessory[] = [];
		const existingAccessoriesList: MagicHomeAccessory[] = [];
		let accessory;
		for (const [uniqueId, controller] of Object.entries(controllers)) {
			// this.log.warn(controller);

			const homebridgeUUID = this.hap.uuid.generate(uniqueId);

			if (this.accessoriesFromDiskMap.has(homebridgeUUID)) {
				this.log.info('Found existing accessory. Updating...');

				const existingAccessory = this.accessoriesFromDiskMap.get(homebridgeUUID);
				accessory = this.processExistingAccessory(controller, existingAccessory);
				this.accessoriesFromDiskMap.delete(homebridgeUUID);
				existingAccessoriesList.push(accessory);
			} else {
				this.log.info('Found new accessory. Registering...');

				accessory = this.createNewAccessory(controller, homebridgeUUID);
				newAccessoriesList.push(accessory);				//add it to new accessory list
			}

			this.activeAccessoriesMap.set(homebridgeUUID, accessory);
		}

		this.registerNewAccessories(newAccessoriesList);	//register new accessories from scan
		this.updateExistingAccessories(existingAccessoriesList);
	}

	registerOfflineAccessories(accessories) {
		accessories.forEach(async (offlineAccessory, homebridgeUUID) => {
			offlineAccessory.context.restartsSinceSeen++;
			const { protoDevice, deviceAPI } = offlineAccessory.context;
			const controller = await this.controllerGenerator.createCustomControllers({ protoDevice, deviceAPI })[0];
			new homekitInterface[deviceAPI.description](this.api, offlineAccessory, this.config, controller, this.log);

			// 	existingAccessoriesList.push(processedAccessory);
			// 	this.log.warn('registering accessory that has been unseen');
		});
	}

	createNewAccessory(controller: BaseController, homebridgeUUID: string): MagicHomeAccessory {

		const {
			protoDevice,
			deviceAPI,
			protoDevice: { uniqueId },
			deviceAPI: { description },
			deviceState: { LED: { RGB, CCT, isOn } },
		} = controller.getCachedDeviceInformation();

		if (!this.isAllowed(uniqueId)) {
			return;
		}

		// //convert RGB to HSL
		// //convert CCT to colorTemperature
		// const HSL = convertRGBtoHSL(RGB)
		// const 
		// const accessoryState: IAccessoryState = {isOn, }			JUST KIDDING, DO IT AFTER INITIALIZING DEVICE

		const newAccessory: MagicHomeAccessory = new this.api.platformAccessory(description, homebridgeUUID) as MagicHomeAccessory;
		newAccessory.context = { protoDevice, deviceAPI, displayName: description as string, restartsSinceSeen: 0 };
		//this.log.warn(description);

		try {
			new homekitInterface[description](this.api, newAccessory, this.config, controller, this.log);
		} catch (error) {
			this.log.error('The controllerLogicType does not exist in accessoryType list.');
			this.log.error(error);
		}
		return newAccessory;
	}

	processExistingAccessory(controller: BaseController, existingAccessory: MagicHomeAccessory) {
		existingAccessory.context.restartsSinceSeen = 0;
		const cachedInformation = controller.getCachedDeviceInformation();
		const {
			protoDevice,
			deviceAPI,
			protoDevice: { uniqueId, ipAddress, modelNumber },
			deviceState, deviceAPI: { description },
		} = cachedInformation;

		if (!this.isAllowed(uniqueId) || !this.isFresh(cachedInformation, existingAccessory)) {
			return;
		}

		_.merge(existingAccessory.context, { protoDevice, deviceAPI, restartsSinceSeen: 0 });
		try {
			new homekitInterface[description](this.api, existingAccessory, this.config, controller, this.log);
		} catch (error) {
			this.log.error('The controllerLogicType does not exist in accessoryType list.');
			this.log.error(error);
		}
		return existingAccessory;

	}

	registerNewAccessories(newAccessories: MagicHomeAccessory[]) {
		// link the accessory to your platform
		this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, newAccessories);

	}

	updateExistingAccessories(existingAccessories: MagicHomeAccessory[]) {
		this.api.updatePlatformAccessories(existingAccessories);
	}

	isFresh(cachedInformation, existingAccessory: MagicHomeAccessory): boolean {


		let isFresh = true;
		const {
			protoDevice: { uniqueId, ipAddress, modelNumber },
			deviceState, deviceAPI: { description },
		} = cachedInformation;

		if (existingAccessory.context.displayName.toString().toLowerCase().includes('delete')) {

			this.unregisterAccessory(existingAccessory,
				`Successfully pruned accessory: ${existingAccessory.context.displayName} 
				due to being marked for deletion\n`);
			isFresh = false;
		} else if (this.config.pruning?.pruneRestarts ?? false) {
			if (existingAccessory.context.restartsSinceSeen >= this.config.pruning.pruneRestarts) {
				this.unregisterAccessory(existingAccessory, `Successfully pruned accessory: ${existingAccessory.context.displayName}
					which had not being seen for ${existingAccessory.context.restartsSinceSeen} restart(s).\n`);
				isFresh = false;
			}
		}

		return isFresh;
	}

	isAllowed(uniqueId: string): boolean {

		const blacklistedUniqueIDs = this.config.deviceManagement?.blacklistedUniqueIDs ?? [];
		const isWhitelist: boolean = this.config.deviceManagement?.blacklistOrWhitelist?.includes('whitelist') ?? false;
		const onList: boolean = (blacklistedUniqueIDs).includes(uniqueId);

		const isAllowed = isWhitelist ? onList : !onList;

		return isAllowed;
		return true;
	}

	unregisterAccessory(existingAccessory: MagicHomeAccessory, reason: string) {
		this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
		this.log.warn(reason);
	}

	//    const accessory = new this.api.platformAccessory(deviceQueryData.lightParameters.convenientName, generatedUUID) as MagicHomeAccessory;

}