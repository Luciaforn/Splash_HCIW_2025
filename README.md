# Splash! ☕️
**A thermal assistant for your drinks.**

**Splash** is an integrated system that enhances the drinking experience through intelligent feedback and real-time monitoring. It is built around:

- **Tangible interaction** – the user simply places a cup with an NFC chip on the surface.  
- **Passive monitoring** – temperature is tracked continuously in real time.  
- **Multimodal feedback** – visual (TFT display), tactile (vibration), and digital (mobile app).  

> Everything revolves around a simple, responsive, environmental user experience.
---

## 🔧 Hardware Components

- **ESP32** – a microcontroller with built-in Wi-Fi and Bluetooth, acting as the system’s main controller.  
- **DS18B20 Temperature Sensor** – for accurate digital temperature readings.  
- **NFC Reader + NFC Tag** – enables identification of the cup through near-field communication.  
- **Vibrating Motor** – provides audio feedback to the user.  
- **TFT Display** – shows visual feedback such as temperature and status.

---

## 💻 Software Stack

- **Mobile App**  
  Developed using **React Native**, allowing cross-platform compatibility (iOS and Android).

- **Embedded Code (ESP32)**  
  Programmed with the **Arduino framework**, a simplified development environment based on **C++**. This allows for rapid prototyping and easy integration with sensors and actuators.

---

## 📂 Repository Structure
In this repository, you can find the complete source code for both the mobile app (folder **App0**) and the ESP32 firmware (file **Splash_Arduino.ino**).

