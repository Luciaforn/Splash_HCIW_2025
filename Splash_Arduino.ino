#include <Adafruit_GFX.h>
#include <Adafruit_PN532.h>
#include <Adafruit_ST7735.h>
#include <ArduinoJson.h>
#include <DallasTemperature.h>
#include <FS.h>
#include <OneWire.h>
#include <SPI.h>
#include <SPIFFS.h>
#include <WiFi.h>
#include <Wire.h>
#include <map>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>

#define ONE_WIRE_BUS 25
#define PN532_SCL 22
#define PN532_SDA 21
#define TFT_CLK   27
#define TFT_CS    13
#define TFT_DC    26
#define TFT_MOSI  14
#define TFT_RST   0
#define VIBR_PIN  4


#define WIFI_TIMEOUT 10000  // 10 seconds

//Hardware variables
Adafruit_PN532 nfc(PN532_SDA, PN532_SCL);
Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_MOSI, TFT_CLK, TFT_RST);
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

//DataBase structure to save the optimal temperatures
struct DrinkTemp {
  String drink;
  float opt_temp;
};

std::map<String, DrinkTemp> drinkDB;
String lastUid = "";
float tempCGlobal = 0.0;
bool inRange = false;
bool rangeActiveted = false;
int contVibr = 2;
bool firstTemp = true;


// Wifi variables
bool wifiConnected = false;
bool offlineMode = false;
unsigned long lastWifiCheck = 0;
const unsigned long WIFI_CHECK_INTERVAL = 30000; // checks every 30 sec

const char* ssid = "Phone_1_7231";
const char* password = "ciaociao";

// Temporary var for tempCheck
bool isIncreasing = true;
float previousTemp = 0.0;
bool monitoringPhase = false;

String uidToString(uint8_t* uid, uint8_t length) {
  String s = "";
  for (uint8_t i = 0; i < length; i++) {
    if (uid[i] < 0x10) s += "0";
    s += String(uid[i], HEX);
  }
  s.toUpperCase();
  return s;
}

void listSPIFFS() {
  File root = SPIFFS.open("/");
  File file = root.openNextFile();
  while (file) {
    Serial.printf("  FILE: %s  SIZE: %d\n", file.name(), file.size());
    file = root.openNextFile();
  }
}

// Updates the DB
void saveDrinkDB() {
  StaticJsonDocument<2048> doc;
  JsonArray arr = doc.to<JsonArray>();

  for (auto &entry : drinkDB) {
    JsonObject obj = arr.createNestedObject();
    obj["uid"] = entry.first;
    obj["drink"] = entry.second.drink;
    obj["opt_temp"] = entry.second.opt_temp;
  }

  File file = SPIFFS.open("/drinks.json", "w");
  if (!file) {
    Serial.println("Error opening file");
    return;
  }

  serializeJsonPretty(doc, file);
  file.close();
  Serial.println("Database saved on SPIFFS");
}

// Default values for the DB
void loadDrinkDB() {
  File file = SPIFFS.open("/drinks.json", "r");
  if (!file || file.size() == 0) {
    Serial.println("File not found, loading default...");
    drinkDB["1DA7B0060A1080"] = {"coffee", 65.0};
    drinkDB["1DABB0060A1080"] = {"tea", 57.0};
    drinkDB["1DAAB0060A1080"] = {"milk", 53.0};
    drinkDB["1DA9B0060A1080"] = {"baby_bottle", 37.0};
    saveDrinkDB();
    return;
  }

  StaticJsonDocument<2048> doc;
  if (deserializeJson(doc, file)) {
    Serial.println("Error parsing JSON");
    return;
  }

  drinkDB.clear();
  for (JsonObject item : doc.as<JsonArray>()) {
    String uid = item["uid"].as<String>();
    String drink = item["drink"].as<String>();
    float temp = item["opt_temp"].as<float>();
    drinkDB[uid] = {drink, temp};
  }

  file.close();
  Serial.println("Database loaded from SPIFFS");
}

// Sends a JSON message to the mobile app with details about the drink detected by the NFC reader.
void sendNFCtoApp(String uid, String drink) {
  if (wifiConnected && !offlineMode) {
    StaticJsonDocument<256> doc;
    doc["type"] = "nfc";
    doc["uid"] = uid;
    doc["drink"] = drink;
    String msg;
    serializeJson(doc, msg);
    ws.textAll(msg);
    Serial.println("NFC sent to the app: " + drink);
  } else {
    Serial.println("Offline Mode - NFC not sent to app");
  }
}


void showStatusOnScreen(String status, uint16_t color = ST77XX_WHITE) {
  tft.fillRect(0, 110, 160, 20, ST77XX_BLACK);
  tft.setCursor(5, 115);
  tft.setTextSize(1);
  tft.setTextColor(color);
  tft.print(status);
}

void manageNFC() {
  uint8_t uid[7];
  uint8_t uidLength;

  if (nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength)) {
    String currentUid = uidToString(uid, uidLength);

    if (currentUid != lastUid) {
      lastUid = currentUid;
      inRange = false;
      rangeActiveted = false;
      contVibr = 2;
      isIncreasing = true;

      tft.fillRect(0, 0, 160, 100, ST77XX_BLACK);
      tft.setCursor(10, 10);
      tft.setTextSize(2);

      if (drinkDB.count(currentUid)) {
        tft.setTextColor(ST77XX_WHITE);
        tft.print(drinkDB[currentUid].drink);
        
        // shows temperature
        tft.setCursor(10, 70);
        tft.setTextSize(1);
        tft.setTextColor(ST77XX_CYAN);
        tft.print("Target: ");
        tft.print(drinkDB[currentUid].opt_temp, 1);
        tft.print("C");
        
        Serial.println("Drink detected: " + drinkDB[currentUid].drink + 
                      " (Target: " + String(drinkDB[currentUid].opt_temp) + "°C)");
        
        // only if connected
        sendNFCtoApp(currentUid, drinkDB[currentUid].drink);
      } else {
        Serial.println("Unknown Tag: " + currentUid);
        tft.fillRect(0, 0, 160, 100, ST77XX_BLACK);
        tft.setCursor(10, 10);
        tft.setTextSize(2);
        tft.setTextColor(ST77XX_RED);
        tft.print("Unknown Tag");
      }
    }
  }
  
}

// Requests the temperature to the sensor, saves it globally and shows in the display
float updateTemperature() {
  float target = drinkDB[lastUid].opt_temp;
  float minRange = target - 3.0;
  float maxRange = target + 3.0;

// The sensor may produce unreliable readings on the first temperature measurement.
  if (firstTemp) {
    sensors.requestTemperatures();
    float temp = sensors.getTempCByIndex(0);
    firstTemp = false;
    Serial.println("firstTemp: " + String(temp));
    temp = 0.0;
    delay(2000);
    return temp;
  } else {
      sensors.requestTemperatures();
      float temp = sensors.getTempCByIndex(0);

      Serial.print("Temp: ");
      Serial.println(temp);
      
      // Update temp Color on screen
      if(temp < minRange){
        if(monitoringPhase){
          tft.fillRect(10, 40, 120, 25, ST77XX_BLACK);
          tft.setCursor(10, 40);
          tft.setTextColor(ST77XX_CYAN);
        }
        else{
          tft.fillRect(10, 40, 120, 25, ST77XX_BLACK);
          tft.setCursor(10, 40);
          tft.setTextColor(ST77XX_WHITE);
        }
      }
      else if(temp >= minRange && temp <= maxRange){
        if(monitoringPhase){
          tft.fillRect(10, 40, 120, 25, ST77XX_BLACK);
          tft.setCursor(10, 40);
          tft.setTextColor(ST77XX_GREEN);
        }
        else{
          tft.fillRect(10, 40, 120, 25, ST77XX_BLACK);
          tft.setCursor(10, 40);
          tft.setTextColor(ST77XX_WHITE);
        }
      }
      else if(temp > maxRange){
        tft.fillRect(10, 40, 120, 25, ST77XX_BLACK);
        tft.setCursor(10, 40);
        tft.setTextColor(ST77XX_RED);
        monitoringPhase = true;
      }

      tft.setTextSize(2);
      tft.print(temp, 1);
      tft.print(" C");

    tempCGlobal = temp;
    return temp;
  }
}


void SendNotificationToApp(String tipo, String messaggio, String drink = "", String type = "") {
  if (wifiConnected && !offlineMode) {
    StaticJsonDocument<256> doc;
    doc["type"] = type;
    doc["notification_type"] = tipo;
    doc["message"] = messaggio;
    doc["drink"] = drink;
    doc["temperature"] = tempCGlobal;
    doc["timestamp"] = millis();
    
    String msg;
    serializeJson(doc, msg);
    ws.textAll(msg);
    Serial.println("Notification sent: " + tipo + " - " + messaggio);
  } else {
    Serial.println("Offline Mode - Notify not sent: " + messaggio);
  }
}


void checkTempRange() {
  if (!drinkDB.count(lastUid)) return;

  float target = drinkDB[lastUid].opt_temp;
  float minRange = target - 3.0;
  float maxRange = target + 3.0;
  float leavingRange = minRange + 0.5;
  String drinkName = drinkDB[lastUid].drink;

  if (tempCGlobal <= previousTemp - 0.05) {
    isIncreasing = false;
    Serial.println("the temp is going down");
  }
  
  else if (tempCGlobal >= previousTemp + 0.05) {
    isIncreasing = true;
    Serial.println("the temp is rising");
  }

  Serial.print("Actual Temp: ");
  Serial.println(tempCGlobal);
  Serial.print("Last Temp: ");
  Serial.println(previousTemp);

  if (monitoringPhase){
    if (tempCGlobal >= minRange && tempCGlobal <= maxRange && !inRange && contVibr>0){
      tft.fillRect(0, 90, 160, 15, ST77XX_BLACK);
      tft.setCursor(5, 92);
      tft.setTextSize(1);
      tft.setTextColor(ST77XX_GREEN);
      tft.print("TEMPERATURE IS GOOD!");
      Serial.println(">> Optimal Temeprature reached!");
      digitalWrite(VIBR_PIN, HIGH);
      delay(500);
      digitalWrite(VIBR_PIN, LOW);
      String messaggio = "YOUR DRINK IS READY!";
      SendNotificationToApp("drink_ready", messaggio, drinkName, "notification_1");
      contVibr--;
      inRange = true;
      }
    else if(tempCGlobal <= leavingRange && inRange && contVibr > 0){
      tft.fillRect(0, 90, 160, 15, ST77XX_BLACK);
      tft.setCursor(5, 92);
      tft.setTextSize(1);
      tft.setTextColor(ST77XX_RED);
      tft.print("Temp declining!");
      Serial.println(">> temp is cooling down!!!");
      String messaggio = "HARRY UP! YOUR DRINK IS GETTING COLD!";
      SendNotificationToApp("drink_cooling", messaggio, drinkName,"notification_2");
      digitalWrite(VIBR_PIN, HIGH);
      delay(500);
      digitalWrite(VIBR_PIN, LOW);
      contVibr--;
      inRange = false;
    }
  }
  previousTemp = tempCGlobal;
}



bool tryWifiConnection() {
  Serial.print("Attempting WiFi connection...");
  WiFi.begin(ssid, password);
  
  unsigned long startTime = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startTime) < WIFI_TIMEOUT) {
    delay(500);
    Serial.print(".");
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
    wifiConnected = true;
    offlineMode = false;
    showStatusOnScreen("WiFi: " + WiFi.localIP().toString(), ST77XX_GREEN);
    return true;
  } else {
    Serial.println("\nWiFi Connection Failed - offline mode");
    wifiConnected = false;
    offlineMode = true;
    showStatusOnScreen("Offline Mode", ST77XX_RED);
    return false;
  }
}

void checkWifiStatus() {
  unsigned long currentTime = millis();
  
  // Checks periodically Wifi connection
  if (currentTime - lastWifiCheck > WIFI_CHECK_INTERVAL) {
    lastWifiCheck = currentTime;
    
    if (WiFi.status() != WL_CONNECTED && wifiConnected) {
      // Connection lost 
      Serial.println("WiFi Connection Lost - offline mode");
      wifiConnected = false;
      offlineMode = true;
      showStatusOnScreen("WiFi disconnected", ST77XX_RED);
    } else if (WiFi.status() == WL_CONNECTED && !wifiConnected) {
      // Connection reenstablished
      Serial.println("WiFi Connection Reestablished");
      wifiConnected = true;
      offlineMode = false;
      showStatusOnScreen("WiFi: " + WiFi.localIP().toString(), ST77XX_GREEN);
      startWS();
    }
  }
}

void startWS() {
    // WiFi connected -- starting server
    ws.onEvent([](AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len) {
      if (type == WS_EVT_CONNECT) {
        Serial.println("🟢 Client WebSocket connected");
      } else if (type == WS_EVT_DISCONNECT) {
        Serial.println("🔴 Client WebSocket disconnected");
      } else if (type == WS_EVT_DATA) {
        data[len] = 0;
        StaticJsonDocument<1024> doc;
        if (deserializeJson(doc, data)) {
          Serial.println("Error parsing WebSocket");
          return;
        }
        String type = doc["type"] | "";
        if (type == "sync") {
          JsonArray arr = doc["db"].as<JsonArray>();
          for (JsonObject obj : arr) {
            String uid = obj["uid"];
            String drink = obj["drink"];
            float opt_temp = obj["opt_temp"];
            drinkDB[uid] = {drink, opt_temp};
          }
          saveDrinkDB();
          Serial.println("✅ DB updated from client");
        }
      }
    });
    server.addHandler(&ws);
    server.on("/getTemp", HTTP_GET, handleGetTemp);
    server.on("/saveTemp", HTTP_POST, handleSaveTemp);
    server.begin();
    Serial.println("WebSocket server ready");
  };

// Handlers for the HTTP calls from the app
void handleGetTemp(AsyncWebServerRequest *request) {
  StaticJsonDocument<128> doc;
  doc["temp"] = tempCGlobal;
  String response;
  serializeJson(doc, response);
  request->send(200, "application/json", response);
}

void handleSaveTemp(AsyncWebServerRequest *request) {
  if (request->hasParam("body", true)) {
    String body = request->getParam("body", true)->value();
    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, body)) {
      request->send(400, "application/json", "{\"error\":\"JSON malformato\"}");
      return;
    }
    String uid = doc["uid"];
    String drink = doc["drink"];
    float temp = doc["opt_temp"];
    drinkDB[uid] = {drink, temp};
    saveDrinkDB();
    request->send(200, "application/json", "{\"status\":\"ok\"}");
    Serial.println("Temperature saved via HTTP for " + drink + ": " + String(temp) + "°C");
  } else {
    request->send(400, "application/json", "{\"error\":\"Corpo mancante\"}");
  }
}

void setup() {
  Serial.begin(115200);
  delay(10);
  Serial.println("Starting System...");

  // Initializes display
  SPI.begin(TFT_CLK, -1, TFT_MOSI, TFT_CS);
  tft.initR(INITR_BLACKTAB);
  tft.setRotation(1);
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(10, 10);
  tft.print("Starting System...");

  // Initializes sensors
  sensors.begin();
  sensors.setResolution(12);
  pinMode(VIBR_PIN, OUTPUT);
  digitalWrite(VIBR_PIN, LOW);

  // Initializes NFC
  Wire.begin(PN532_SDA, PN532_SCL);
  nfc.begin();
  if (!nfc.getFirmwareVersion()) {
    Serial.println("NFC Module Not Found");
    tft.setCursor(10, 30);
    tft.setTextColor(ST77XX_RED);
    tft.print("ERROR: NFC not found");
    while (1) delay(10);
  }
  nfc.SAMConfig();
  Serial.println("NFC ready");

  // Initializes SPIFFS
  if (SPIFFS.begin(true)) {
    loadDrinkDB();
    listSPIFFS();
    Serial.println("SPIFFS initialized");
  } else {
    Serial.println("Error SPIFFS");
  }

  // Tries WiFi connection
  tft.setCursor(10, 30);
  tft.print("Connecting to WiFi...");
  
  if (tryWifiConnection()) {
    // WiFi connected - starting server
    startWS();
  }

  // Clean display and show principal interface
  delay(2000);
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextSize(2);
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(10, 10);
  tft.print("Place");
  tft.setCursor(10,40);
  tft.print("your drink");
  tft.setCursor(10,70);
  tft.print("to start!");
  
  Serial.println("Sistem initiated - Always-on core functionality");
}

void loop() {
 
  checkWifiStatus();
  
  // Core functionalities
  manageNFC();
  updateTemperature();
  checkTempRange();
  
  delay(1000);
}
