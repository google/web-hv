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

let progress;

$(function () {
	progress = $("#main-progress");

	$("#device-picker").click(function () {
		handleSelectDevice(navigator.usb.requestDevice({ filters: [ADB_DEVICE_FILTER] }));
	});

	const loadFile = function() {
		if (!this.files || this.files.length < 1) {
			return;
		}
		progress.show();
		const w = createWorker("js/file_load_worker.js");
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
				const appInfo = e.data;
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
	}
	$("#hierarchy-picker-input").on("change", loadFile);
	const pickerButton = $("#hierarchy-picker")
		.click(() => $("#hierarchy-picker-input").click())
		.on('dragover dragenter', () => pickerButton.addClass('drag_over'))
		.on('dragleave dragend drop', () => pickerButton.removeClass('drag_over'))
		.on('drop', e => loadFile.call(e.originalEvent.dataTransfer))
		.on('drag dragstart dragend dragover dragenter dragleave drop', function(e) {
			e.preventDefault();
			e.stopPropagation();
		});

	// Load any verified devices
	refreshConnectedDevices();
	navigator.usb.addEventListener("connect", refreshConnectedDevices);
	navigator.usb.addEventListener("disconnect", refreshConnectedDevices);
	ActiveState.push(function() {
		navigator.usb.removeEventListener("connect", refreshConnectedDevices);
		navigator.usb.removeEventListener("disconnect", refreshConnectedDevices);
	});

	if (isDarkTheme()) {
		switchTheme();
	}

	// Check url hash
	const urlParams = new URLSearchParams(window.location.search);
	if (urlParams.get("mode") == "mirror") {
		// Switch to mirror mode
		$("#main-title-wrapper").html("<h2>Mirror android screen</h2>");
		activityListAction = deviceMirrorAction;
	}
})

function refreshConnectedDevices() {
	navigator.usb.getDevices().then(devices => {
		const container = $("#connected-devices");
		container.empty();
		$("#connected-devices-title")[devices.length == 0 ? "hide" : "show"]();
		for (let i = 0; i < devices.length; i++) {
			const d = devices[i];
			const entry = $("<div>").data("device", d).appendTo(container).click(verifiedDeviceClicked).addClass("entry");
			$('<div class="title">').text(d.manufacturerName + " " + d.productName).appendTo(entry);

			const subText = $('<div class="subtext">').appendTo(entry);
			$("<label>").text("serial: " + d.serialNumber).appendTo(subText);
		}
	});
}

function verifiedDeviceClicked() {
	const d = $(this).data("device");
	handleSelectDevice(Promise.resolve(d));
}

function handleSelectDevice(devicePromise) {
	devicePromise.then(selectedDevice => {
		progress.show();
		return openAndClaim(selectedDevice);
	})
		.catch(error => {
			progress.hide();
			toast("Unable to connect " + error);
			console.log(error);
		});
}

let adbDevice;

async function openAndClaim(device) {
	console.debug("Opening device", device);
	await device.open();
	await device.selectConfiguration(1);

	// Find interface
	let interface = null;
	const interfaces = device.configuration.interfaces;
	for (let i = 0; i < interfaces.length; i++) {
		interface = interfaces[i];
		const iface = interface.alternates[0];
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

	try {
		await device.claimInterface(interface.interfaceNumber);
	} catch(e) {
		console.log("Device is use, trying reset");
		await device.reset();
		try {
			await device.claimInterface(interface.interfaceNumber);
		} catch (e) {
			console.log("Reset pending, waiting some time");
			await new Promise(r => setTimeout(r, 500));

			try {
				await device.claimInterface(interface.interfaceNumber);
			} catch (e) {
				await new Promise(r => setTimeout(r, 500));
				await device.claimInterface(interface.interfaceNumber);
			}
		}
	}

	$(window).on('beforeunload', function () {
		device.releaseInterface(interface.interfaceNumber);
		device.close();
	});
	console.log("Device connected, starting handshake");
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

	document.title = adbDevice.device.manufacturerName + " " + adbDevice.device.productName;
	activityListAction(function(callbacks) {
		const client = new DDMClient(adbDevice, callbacks);
		client.loadOldWindows();
		client.trackProcesses();
	});
}

function switchTheme() {
	const isDark = $(document.body).toggleClass("darkTheme").hasClass("darkTheme");
	$("#darkThemeSwitch").text(isDark ? "Lights on" : "Lights off");
	localStorage.isDarkTheme = isDark;
}

function isDarkTheme() {
	return localStorage.isDarkTheme == "true";
}

/**
 * Adds a node displaying the error message in the container
 */
$.fn.showError = function(msg) {
  $("#main-progress").hide();
  return this.empty().removeClass("hide").removeClass("hidden").append($("<span>").text(msg).addClass("error"));
}