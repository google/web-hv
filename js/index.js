// Copyright 2018 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

var progress;

$(function () {
	progress = $("#main-progress");

	$("#device-picker").click(function () {
		handleSelectDevice(navigator.usb.requestDevice({ filters: [ADB_DEVICE_FILTER] }));
	});

	$("#hierarchy-picker").click(function () {
		$("#hierarchy-picker-input").click();
	});

	$("#hierarchy-picker-input").on("change", function () {
		if (!this.files || this.files.length < 1) {
			return;
		}
		progress.show();
		var w = createWorker("js/file_load_worker.js");
		w.onerror = function(e) {
			progress.hide();
			toast("Not a valid view hierarchy file: " + e.message);
		};
		w.onmessage = function (e) {
			if (e.data.type == TYPE_BUG_REPORT) {
				activityListAction(function(callbacks) {
					callbacks.windowsLoaded(e.data.list);
				})
			} else if (e.data.type == TYPE_ZIP) {
				var appInfo = e.data;
				appInfo.data = new JSZip(appInfo.data);
				hViewAction(appInfo);
			} else if (e.data.type == TYPE_ERROR) {
				w.onerror(e.data);
			} else {
				progress.hide();
				toast("Unknown response " + e.data.type);
			}
		}
		w.postMessage(this.files[0]);
	});

	// Load any verified devices
	navigator.usb.getDevices().then(devices => {
		if (devices.length == 0) {
			return;
		}
		let container = $("#device-list-content");
		$("<h3>").text("Authorized devices").appendTo(container);
		container = $("<div>").addClass("activity-list").appendTo(container);

		for (let i = 0; i < devices.length; i++) {
			let d = devices[i];
			let entry = $("<div>").data("device", d).appendTo(container).click(verifiedDeviceClicked).addClass("entry");
			$('<div class="title">').text(d.manufacturerName + " " + d.productName).appendTo(entry);

			let subText = $('<div class="subtext">').appendTo(entry);
			$("<label>").text("serial: " + d.serialNumber).appendTo(subText);
		}
	});
})

function verifiedDeviceClicked() {
	var d = $(this).data("device");
	handleSelectDevice(Promise.resolve(d));
}

function handleSelectDevice(devicePromise) {
	devicePromise.then(selectedDevice => {
		progress.show();
		return openAndClaimWithRetry(selectedDevice);
	})
		.catch(error => {
			progress.hide();
			toast("Unable to connect " + error);
			console.log(error);
		});
}

async function openAndClaimWithRetry(device) {
	try {
		await openAndClaim(device);
	} catch (e) {
		console.log("Error claiming, reset and try again", e);
		await device.reset();
		await openAndClaim(device);
	}
}

var adbDevice;

async function openAndClaim(device) {
	console.debug("Opening device", device);
	await device.open();

	// Find interface
	var interface = null;
	var interfaces = device.configuration.interfaces;
	for (var i = 0; i < interfaces.length; i++) {
		interface = interfaces[i];
		var iface = interface.alternates[0];
		if (iface.interfaceClass === ADB_INTERFACE_CLASS &&
			iface.interfaceSubclass === ADB_INTERFACE_SUB_CLASS &&
			iface.interfaceProtocol === ADB_INTERFACE_PROTOCOL) {
			break;
		}
		interface = null;
	}

	if (interface == null) {
		throw "No interface found";
	}

	await device.claimInterface(interface.interfaceNumber);
	$(window).on('beforeunload', function () {
		device.releaseInterface(interface.interfaceNumber);
	});
	adbDevice = new AdbDevice(device, interface);
	adbDevice.stateCallback = onDeviceStateChange;
	await adbDevice.connect();
}

function onDeviceStateChange(newState) {
	if (newState != STATE_CONNECTED_DEVICE) {
		return;
	}

	ActiveState.push(function () {
		adbDevice.closeAll();
	});

	console.info("Device connected");
	document.title = adbDevice.device.manufacturerName + " " + adbDevice.device.productName;
	activityListAction(function(callbacks) {
		var client = new DDMClient(adbDevice, callbacks);
		client.loadOldWindows();
		client.trackProcesses();
	});
}
