import { BaseController, ControllerGenerator } from 'magichome-platform';
import { MagicHomeAccessory } from './magichome-interface/types';
import {
	API,
	APIEvent,
	DynamicPlatformPlugin,
	HAP,
	Logging,
	PlatformAccessory,
	PlatformConfig,
} from 'homebridge';

import { homekitInterface } from './magichome-interface/types';

import { HomebridgeMagichomeDynamicPlatformAccessory } from './platformAccessory';
import { on } from 'events';
import { create } from 'domain';

const PLATFORM_NAME = 'homebridge-magichome-dynamic-platform';
const PLUGIN_NAME = 'homebridge-magichome-dynamic-platform';

class AccessoryGenerator {
	private log;

	public readonly accessoriesFromDiskMap: Map<string, MagicHomeAccessory> = new Map();

	private hap: HAP;
	private api: API;
	private config: PlatformConfig;
	private controllerGenerator: ControllerGenerator;

	constructor({ hap, api, log, config, accessoriesFromDiskMap, controllerGenerator }) {
		this.hap = hap;
		this.api = api;
		this.log = log;
		this.accessoriesFromDiskMap = accessoriesFromDiskMap;
		this.controllerGenerator = controllerGenerator;
	}

	public async generateAccessories() {
		return await this.controllerGenerator.discoverControllers().then(async controllers => {
			return this.discoverAccessories(controllers);
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

	rescanAccessories(controllers: Map<string, BaseController>) {

		const newAccessoriesList: MagicHomeAccessory[] = [];

		controllers.forEach((controller) => {
			const {
				protoDevice: { uniqueId, ipAddress, modelNumber },
				deviceState, deviceAPI,
			} = controller.getCachedDeviceInformation();
			const homebridgeUUID = this.hap.uuid.generate(uniqueId);

			if (this.accessoriesFromDiskMap[homebridgeUUID]) {
				const existingAccessory = this.accessoriesFromDiskMap[homebridgeUUID];
				this.accessoriesFromDiskMap.delete[homebridgeUUID];
				this.processExistingAccessory(existingAccessory);

			} else {
				const newAccessory = this.createNewAccessory({ controller, homebridgeUUID });
				newAccessoriesList.push(newAccessory);				//add it to new accessory list
				this.log.printDeviceInfo('Registering new accessory...!', newAccessory);
			}

		});

		this.registerNewAccessories(newAccessoriesList);	//register new accessories from scan
	}

	discoverAccessories(controllers: Map<string, BaseController>) {

		const newAccessoriesList: MagicHomeAccessory[] = [];
		const existingAccessoriesList: MagicHomeAccessory[] = [];

		controllers.forEach((controller) => {
			const {
				protoDevice: { uniqueId, ipAddress, modelNumber },
				deviceState, deviceAPI,
			} = controller.getCachedDeviceInformation();
			const homebridgeUUID = this.hap.uuid.generate(uniqueId);

			if (this.accessoriesFromDiskMap[homebridgeUUID]) {

				const existingAccessory = this.accessoriesFromDiskMap[homebridgeUUID];
				const ipAddressOld = controller.getCachedDeviceInformation().protoDevice.ipAddress;
				const processedAccessory = this.processExistingAccessory({existingAccessory, ipAddressNew});

				this.accessoriesFromDiskMap.delete[homebridgeUUID];

				existingAccessoriesList.push(processedAccessory);
		
				this.log.printDeviceInfo('Registering existing accessory...!', processedAccessory);

			} else {
				const newAccessory = this.createNewAccessory({ controller, homebridgeUUID });
				newAccessoriesList.push(newAccessory);				//add it to new accessory list
				this.log.printDeviceInfo('Registering new accessory...!', newAccessory);
			}

		});

		this.registerNewAccessories(newAccessoriesList);	//register new accessories from scan
		this.registerExistingAccessories(existingAccessoriesList);
	}

	createNewAccessory({ controller, homebridgeUUID }): MagicHomeAccessory {
		const {
			protoDevice: { uniqueId, ipAddress, modelNumber },
			deviceState, deviceAPI: { description },
		} = controller.getCachedDeviceInformation();

		if (!this.isAllowed(uniqueId)) {
			this.log.warn(`Warning! New device with Unique ID: ${uniqueId} is blacklisted or is not whitelisted.\n`);
			return;
		}

		const newAccessory: MagicHomeAccessory = new this.api.platformAccessory(description, homebridgeUUID) as MagicHomeAccessory;
		newAccessory.context = { displayName: description, scansSinceSeen: 0 };
		try {
			new homekitInterface[description](this, newAccessory, this.config, controller);
		} catch (error) {
			this.log.error('[1] The controllerLogicType does not exist in accessoryType list. Did you migrate this? controllerLogicType=', accessory.context.device?.lightParameters?.controllerLogicType);
			this.log.error('device object: ', newAccessory.context.controller);
		}

		return newAccessory;
	}

	processExistingAccessory({existingAccessory, ipAddressNew}) {
 const deviceInfo = existingAccessory.context.controller.getCachedDeviceInformation();
 const {
	protoDevice: { uniqueId, ipAddress, modelNumber },
	deviceState, deviceAPI: { description },
} = deviceInfo;
		

		if (!this.isAllowed(uniqueId)) {
			this.log.warn(`Warning! New device with Unique ID: ${uniqueId} is blacklisted or is not whitelisted.\n`);
			return;
		}

		if(ipAddressNew !== ipAddress) {
			ipAddress = ipAddressNew;
		}



	}

	registerNewAccessories(newAccessories: MagicHomeAccessory[]) {
		// link the accessory to your platform
		this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, newAccessories);

	}

	registerExistingAccessories(existingAccessories: MagicHomeAccessory[]) {
		this.api.updatePlatformAccessories(existingAccessories);
	}


	isAllowed(uniqueId): boolean {

		const blacklistedUniqueIDs = this.config.deviceManagement.blacklistedUniqueIDs;
		const isWhitelist: boolean = this.config.deviceManagement.blacklistOrWhitelist.includes('whitelist');
		const onList: boolean = (blacklistedUniqueIDs).includes(uniqueId);

		const isAllowed = isWhitelist ? onList : !onList;

		return isAllowed;
	}

	//    const accessory = new this.api.platformAccessory(deviceQueryData.lightParameters.convenientName, generatedUUID) as MagicHomeAccessory;

}