## 🤖🤖🤖 Getting Started with multiple devices

1. Register your device by adding your ESP32 Device's MAC Address and a unique user code to the `devices` table in Supabase.
> **Pro Tip:** To find your ESP32-S3 Device's MAC Address, build and upload `test/print_mac_address_test.cpp` using PlatformIO and view the serial monitor.


2. Register your user account to this device by adding your unique user code to the [Settings page](http://localhost:3000/home/settings) in the NextJS Frontend. This links your device to your account.


3. Set DEV_MODE to `False` in your `frontend-nextjs/.env.local` env variable.

> **Pro Tip:** If you're testing locally, you can keep enabled the `DEV_MODE` macro in the `Config.h` file of your firmware and the Deno server env variable to use your local IP addresses for testing.


4. Now you can register multiple devices to your account by repeating the process above.