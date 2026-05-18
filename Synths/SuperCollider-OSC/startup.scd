Server.scsynth;

o = Server.local.options;

//Post << ServerOptions.inDevices;
//Post << ServerOptions.outDevices;

o.numInputBusChannels = 0;
o.numOutputBusChannels = 2;

//o.inDevice_("MacBook Pro Microphone");
//o.inDevice_("BlackHole 2ch");

//o.outDevice_("Default");
//o.outDevice_("External Headphones");
//o.outDevice_("MacBook Pro Speakers");

o.device_("BlackHole 2ch");
//o.device_("Default");

o.sampleRate = 48000;
o.blockSize = 64;
o.hardwareBufferSize = 64;

o.numBuffers = 1024 * 256;
o.numWireBufs = 2048;
o.maxNodes = 8192 * 128;
o.memSize = 8192 * 128;
o.numPrivateAudioBusChannels = 1024;
