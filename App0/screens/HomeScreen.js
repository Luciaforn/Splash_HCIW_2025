import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import Svg, { Polygon } from 'react-native-svg';
import * as Permissions from 'expo-permissions';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  Modal,
  SafeAreaView,
  Dimensions,
  ImageBackground,
  TouchableWithoutFeedback,
  Alert
} from 'react-native';
import { useFonts } from 'expo-font';
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function registerForPushNotificationsAsync() {
  const { status: existingStatus } = await Permissions.getAsync(Permissions.NOTIFICATIONS);
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Permissions.askAsync(Permissions.NOTIFICATIONS);
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    alert('Non hai permesso di ricevere notifiche (cojone)!');
    return false;
  }

  return true;
}

// DrinkCard component - a clickable card displaying a drink's name and image
const DrinkCard = ({ name, image, onPress }) => (
  <TouchableOpacity style={styles.drinkCard} onPress={onPress}>
    <Image source={{ uri: image }} style={styles.drinkImage} />
    <Text style={styles.drinkName}>{name}</Text>
  </TouchableOpacity>
);

// Main component
export default function App() {
  const [temperature, setTemperature] = useState(60);
  const [selectedDrink, setSelectedDrink] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [serverTemp, setServerTemp] = useState(null);
  const [tempEdit, setTempEdit] = useState(60);
  const navigation = useNavigation();
  const [esp32Response, setEsp32Response] = useState('');
  const [showTemperature, setShowTemperature] = useState(false);
  // WebSocket states
  const [ws, setWs] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [detectedDrink, setDetectedDrink] = useState(null);
  const ESP32_IP = "10.72.66.146"; 


  const [fontsLoaded] = useFonts({
    'Nunito': require('../assets/Nunito.ttf'),
    'Quicksand': require('../assets/Quicksand.ttf'),
    'Raleway': require('../assets/Raleway.ttf'),
    'Jersey': require('../assets/Jersey.ttf'),
    'Digital': require('../assets/Digital.ttf')
  });

  // List of available drinks with default temperatures and icons
  const defaultDrinks = [
    {
      uid: '1DA7B0060A1080',
      name: 'Coffee',
      image: 'https://img.icons8.com/ios-filled/100/espresso-cup.png',
      defaultTemp: 65
    },
    {
      uid: '1DAAB0060A1080',
      name: 'Milk',
      image: 'https://img.icons8.com/ios-filled/100/milk-bottle.png',
      defaultTemp: 53
    },
    {
      uid: '1DABB0060A1080',
      name: 'Tea',
      image: 'https://img.icons8.com/ios-filled/100/tea.png',
      defaultTemp: 57
    },
    {
      uid: '1DA9B0060A1080',
      name: 'BabyBottle', 
      image: 'https://img.icons8.com/sf-regular-filled/100/baby-bottle.png',
      defaultTemp: 37
    },
    {
      uid: '1DAFB0060A1080',
      name: 'Chocolate',
      image: 'https://img.icons8.com/ios-filled/100/coffee.png',
      defaultTemp: 55
    }
  ];

  const [drinks, setDrinks] = useState(defaultDrinks);

  // WebSocket setup
  useEffect(() => {
    const connectWebSocket = () => {
      try {
        const websocket = new WebSocket(`ws://${ESP32_IP}/ws`);
        
        websocket.onopen = () => {
          console.log('WebSocket connesso');
          setWsConnected(true);
          
          
          // Sends the drink database to the server when it connects
          const syncMessage = {
            type: 'sync',
            db: drinks.map(drink => ({
              uid: drink.uid,
              drink: drink.name,
              opt_temp: drink.defaultTemp
            }))
          };
          websocket.send(JSON.stringify(syncMessage));
        };

        websocket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('Messaggio ricevuto:', data);
            if (data.type === 'nfc') {
              // NFC detected from the server
              const { uid, drink } = data;
              console.log(`NFC rilevato: ${drink} (${uid})`);
              
              const foundDrink = drinks.find(d => d.uid === uid);
              if (foundDrink) {
                setDetectedDrink(foundDrink);
              } else {
                setDetectedDrink(null);
              }
            }
            else if (data.type === 'notification_1' || data.type === 'notification_2') {
               handleNotificationMessage(data);
    }
          } catch (error) {
            console.error('Errore parsing messaggio WebSocket:', error);
          }
        };

        websocket.onclose = () => {
          console.log('WebSocket disconnesso'); 
          setWsConnected(false);
          setEsp32Response('Disconnesso dal dispositivo'); 
          setDetectedDrink(null);
          
          setTimeout(connectWebSocket, 3000);
        };

        websocket.onerror = (error) => {
          console.error('Errore WebSocket:', error); 
          setWsConnected(false);
          setEsp32Response('Errore di connessione'); 
        };

        setWs(websocket);
        
      } catch (error) {
        console.error('Errore connessione WebSocket:', error);
        setEsp32Response('Impossibile connettersi al dispositivo'); 
        
        setTimeout(connectWebSocket, 5000);
      }
    };

    connectWebSocket();

    // Cleanup
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  // Timer to hide the temperature after 3 second
  useEffect(() => {
    if (showTemperature) {
      const timer = setTimeout(() => {
        setShowTemperature(false);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [showTemperature]);

  // Sync drinks database when it changes
  useEffect(() => {
    if (ws && wsConnected && drinks.length > 0) {
      const syncMessage = {
        type: 'sync',
        db: drinks.map(drink => ({
          uid: drink.uid,
          drink: drink.name,
          opt_temp: drink.defaultTemp
        }))
      };
      ws.send(JSON.stringify(syncMessage));
      console.log('Database sincronizzato con ESP32');
    }
  }, [drinks, ws, wsConnected]);

  // Load drinks from AsyncStorage
  useEffect(() => {
    const loadDrinks = async () => {
      try {
        //await AsyncStorage.removeItem('@drinks');
        const savedDrinks = await AsyncStorage.getItem('@drinks');
        if (savedDrinks !== null) {
          const parsed = JSON.parse(savedDrinks);

          const isValid = Array.isArray(parsed) &&
            parsed.every(d => typeof d.uid === 'string' && typeof d.name === 'string');

          if (isValid) {
            setDrinks(parsed);

          } else {
            console.warn("Dati corrotti in AsyncStorage, ripristino quelli di default");
            await AsyncStorage.setItem('@drinks', JSON.stringify(defaultDrinks));
            setDrinks(defaultDrinks);
          }
        }
      } catch (e) {
        console.log('Errore nel caricamento dei drink:', e);
        await AsyncStorage.setItem('@drinks', JSON.stringify(defaultDrinks));
        setDrinks(defaultDrinks);
      }
    };

    loadDrinks();
  }, []);

  // Function to open modal and set selected drink
  const openDrinkModal = (drink) => {
    setSelectedDrink(drink);
    setTempEdit(drink.defaultTemp || 60);
    setModalVisible(true);
  };

  // Function to save edited temperature and update drink list
  const saveTemp = async () => {
    if (selectedDrink) {
      try {
        const updatedDrinks = drinks.map((drink) => {
          if (drink.uid === selectedDrink.uid) {
            return { ...drink, defaultTemp: tempEdit };
          }
          return drink;
        });

        setDrinks(updatedDrinks);
        setTemperature(tempEdit);
        setModalVisible(false);

        // Save on AsyncStorage the update drinks
        await AsyncStorage.setItem('@drinks', JSON.stringify(updatedDrinks));

        // Send data to the server via HTTP 
        const payload = {
          uid: selectedDrink.uid,
          drink: selectedDrink.name,
          opt_temp: tempEdit
        };

        const formData = new FormData();
        formData.append('body', JSON.stringify(payload));

        const response = await fetch(`http://${ESP32_IP}/saveTemp`, {
          method: 'POST',
          body: formData
        });

        if (response.ok) {
          const result = await response.json();
          console.log('Dati salvati sul server:', result);
          
          // Synchronize also via WebSocket
          if (ws && wsConnected) {
            const syncMessage = {
              type: 'sync',
              db: updatedDrinks.map(drink => ({
                uid: drink.uid,
                drink: drink.name,
                opt_temp: drink.defaultTemp
              }))
            };
            ws.send(JSON.stringify(syncMessage));
          }
        } else {
          console.error('Errore nel salvataggio sul server:', response.status);
        }

      } catch (e) {
        console.log('Failed to save drinks or send to server:', e);
        Alert.alert('Errore', 'Impossibile salvare le impostazioni');
      }
    }
  };


  async function handleNotificationMessage(data) {
    const { message, drink, temperature, notification_type } = data;
    //const alertMessage = `${message}${drink ? `: ${drink}` : ''}${temperature ? ` (${temperature}°C)` : ''}`; //todo:togliere se funzionano notifiche
    const alertMessage = `${message}`;
    await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Splash!💦',
      body: alertMessage,
      sound: 'default',
    },
    trigger: null, 
  });
  }

  const handleFetchESP32 = () => {
    fetch(`http://${ESP32_IP}/getTemp`)
      .then(res => res.json())  
      .then(data => {
        const tempStr = data.temp;
        setServerTemp(tempStr);
        setEsp32Response('');  
      })
      .catch(err => {
        setEsp32Response("Errore: impossibile contattare ESP32");
        setServerTemp(null);
      });
  };

function changeColor(tempStr) {
    if (!detectedDrink) return 'gray';

    const idealTemperature = detectedDrink.defaultTemp;
    const currentTemp = parseFloat(tempStr);

    if (isNaN(currentTemp)) return 'gray';

    const lowerBound = idealTemperature - 3;
    const upperBound = idealTemperature + 3;

    if (currentTemp > upperBound) return 'red';
    if (currentTemp < lowerBound) return 'dodgerblue';
    return 'green';
}

  return (
    <SafeAreaView style={styles.container}>
      <ImageBackground
        source={require('../assets/backgroundApp.jpg')}
        style={styles.background}
        resizeMode="cover"
      >

        {/* Connection status indicator */}
        <View style={styles.connectionStatus}>
          <View style={[styles.statusDot, { backgroundColor: wsConnected ? '#4CAF50' : '#F44336' }]} />
          <Text style={styles.statusText}>
            {wsConnected ? 'Connected' : 'Disconnected'}
          </Text>
        </View>

        {/* Logo section */}
        <View style={styles.spaceForLogo}>
          <Image 
            style={styles.logo} 
            source={require('../assets/logo.png')} 
          />        
        </View>
        {/* My Drinks list */}
        <View style={styles.drinksSection}>
          <Text style={styles.sectionTitle}>My Drink</Text>
          <FlatList
            data={drinks}
            keyExtractor={(item) => item.uid}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 15 }}
            renderItem={({ item }) => (
              <DrinkCard
                name={item.name}
                image={item.image}
                onPress={() => openDrinkModal(item)}
              />
            )}
          />
        </View>

        {/* Cup section with detected drink info */}
        <TouchableOpacity style={styles.writtenSection}> 

          <View style={styles.containerEsp32Resp}>
            {esp32Response !== '' && (
              <Text style={styles.esp32RespText}>
                {esp32Response}
              </Text>
            )}
          </View>
          {detectedDrink ? (
            <>
              <View style={styles.imageContainer}>
                <TouchableOpacity onPress={() => {
                  handleFetchESP32();
                  setShowTemperature(true);
                }}>
                  <Image 
                    source={imgnfc[detectedDrink.name]} 
                    style={styles.detectedDrinkImage}/> 
                </TouchableOpacity>
                
                {showTemperature && serverTemp !== null && (
                  <View style={[styles.overlayTemperatureContainer,
                    {backgroundColor: changeColor(serverTemp)}
                  ]}> 
                    <Text style={styles.overlayTemperatureText}>
                      {serverTemp.toFixed(1)}°C 
                    </Text>
                  </View>
                )}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.writtenPlace}>Place</Text>
              <Text style={styles.writtenPlace}>your drink</Text>
              <Text style={styles.writtenPlace}>to start!</Text>
            </>
          )}

        </TouchableOpacity>

        <Svg style={styles.saucer}>
          <Polygon
            points="50,20 250,20 270,0 30,0"
            fill="#000"
          />
        </Svg>

        {/* Modal to edit temperature of selected drink */}
        <Modal
          visible={modalVisible}
          animationType="fade"
          transparent
          onRequestClose={() => setModalVisible(false)}
        >
          <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={styles.modalContent}>
                  {selectedDrink && (
                    <>
                      <Image
                        source={{ uri: selectedDrink.image }}
                        style={styles.modalImage}
                      />
                      <Text style={styles.modalTitle}>{selectedDrink.name}</Text>
                      <Text style={styles.modalSubtitle}>Ideal temperature</Text>

                      <View style={styles.tempControls}>
                        <TouchableOpacity
                          style={styles.tempButton}
                          onPress={() => setTempEdit((prev) => Math.max(0, prev - 1))}
                        >
                          <Text style={styles.tempButtonText}>-</Text>
                        </TouchableOpacity>
                        <Text style={styles.tempValue}>{tempEdit}°C</Text>
                        <TouchableOpacity
                          style={styles.tempButton}
                          onPress={() => setTempEdit((prev) => prev + 1)}
                        >
                          <Text style={styles.tempButtonText}>+</Text>
                        </TouchableOpacity>
                      </View>

                      <TouchableOpacity style={styles.saveButton} onPress={saveTemp}>
                        <Text style={styles.saveButtonText}>Save!</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      </ImageBackground>
    </SafeAreaView>
  );
}

// Theme colors
const theme = {
  darkestColor: '#9d724c',
  darkColor: '#d9a87c',
  lightColor: '#f5d0ae',
  lighterColor: '#ffdebf'
};

//nfc images
const imgnfc = {
  Coffee: require('../assets/expresso.png'),
  BabyBottle: require('../assets/babyBottle.png'),
  Milk:require('../assets/milk.png'),
  Chocolate:require('../assets/chocolate.png'),
  Tea:require('../assets/tea.png')
};

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.darkColor
  },
  
  background: {
    flex: 1,
    resizeMode: 'cover',
    justifyContent: 'center',
  },

  statsBar: {
    width: 4,
    backgroundColor: '#000',
    borderRadius: 2,
    marginHorizontal: 2,
  },

  connectionStatus: {
    position: 'absolute',
    top: 400, 
    left: 30,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },

  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },

  statusText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },

  sectionTitle: {
    fontSize: 34,
    fontWeight: 'bold',
    marginLeft: 30,
    marginBottom: 15,
    fontFamily: 'Nunito'
  },

  drinkCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginRight: 15,
    width: 140,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },

  drinkImage: {
    width: 80,
    height: 80,
    marginBottom: 5,
  },

  drinkName: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 8,
    fontFamily: "Raleway"
  },

  saucer: {
    position: 'absolute',
    bottom: 85,
    left: '50%',
    transform: [{ translateX: -150 }],
    height: 20,
    width: 300,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  modalContent: {
    backgroundColor: "#fff",
    padding: 30,
    borderRadius: 20,
    width: '80%',
    alignItems: 'center',
  },

  modalImage: {
    width: 80,
    height: 80,
    marginBottom: 15,
  },

  modalTitle: {
    fontSize: 35,
    fontWeight: 'bold',
    marginBottom: 10,
  },

  modalSubtitle: {
    fontSize: 16,
    marginBottom: 10,
    color: '#555',
  },

  tempControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },

  tempButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.lightColor,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 20,
  },

  tempButtonText: {
    fontSize: 24,
    fontWeight: 'bold',
  },

  tempValue: {
    fontSize: 30,
    fontWeight: '600',
  },

  saveButton: {
    backgroundColor: theme.darkColor,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 30,
    width: 90
  },

  saveButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center'
  },

  writtenPlace: {
    fontSize: 40,
    fontWeight: '700',
    color: '#000',
    textAlign: 'left',
    fontFamily: "Nunito",
    marginTop: -7
  },  

  writtenSection: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',  
      marginTop: -10,
      width: '100%',
      marginLeft: 0 
  },

  requiredTemperature: { 
    fontSize: 28, 
    color: '#000', 
    marginTop: 15,
    backgroundColor: '#fff',
    width: 200
  },

  esp32RespText:{
    color: 'rgb(255, 0, 0)',
    fontSize: 15,
    fontWeight:600,
    backgroundColor: '#fff'
  },

   containerEsp32Resp:{ 
    height: 20, 
    justifyContent: 'center',
    bottom:35
   },

  //container of the image of the nfc
  imageContainer: { 
    position: 'relative',
    alignItems: 'center', 
    width: '100%',
},

  overlayTemperatureContainer: {
    position: 'absolute',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderColor: '#000',
    borderWidth: 2.2,
    opacity: 0.8,
    bottom: 50
  },

  overlayTemperatureText: {
    fontSize: 27,
    color: '#000',
    fontWeight: 'bold',
    textAlign: 'center',
    fontFamily: "Digital"
  },

  //Error messages
  responseText: { 
    fontSize: 16,
    color: '#000',
    marginTop: 10,
    textAlign: 'left',
  },

detectedDrinkImage: {
  width: 200,
  height: 200,
  bottom: 10
},
  
  spaceForLogo: {
    justifyContent: 'center',
    alignItems: 'center'
  },

  logo: {
    height: 120,
    width: 120
  }
});