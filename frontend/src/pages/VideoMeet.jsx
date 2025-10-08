import React, { useEffect, useRef, useState, useCallback } from 'react';
import io from "socket.io-client";
import { Badge, IconButton, TextField } from '@mui/material';
import { Button } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import styles from "../styles/videoComponent.module.css";
import CallEndIcon from '@mui/icons-material/CallEnd'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import ChatIcon from '@mui/icons-material/Chat'
import server from '../environment';

const server_url = server;

// Connections object should be outside or managed with a ref
const connections = {}; 
const localSenders = {}; // To store RTCRtpSender objects for track replacement

const peerConfigConnections = {
    "iceServers": [
        { "urls": "stun:stun.l.google.com:19302" }
    ]
}

// Helper function for a black video track
const black = ({ width = 640, height = 480 } = {}) => {
    let canvas = Object.assign(document.createElement("canvas"), { width, height });
    canvas.getContext('2d').fillRect(0, 0, width, height);
    let stream = canvas.captureStream();
    return Object.assign(stream.getVideoTracks()[0], { enabled: false });
}
// Helper function for a silent audio track
const silence = () => {
    let ctx = new AudioContext();
    let oscillator = ctx.createOscillator();
    let dst = oscillator.connect(ctx.createMediaStreamDestination());
    oscillator.start();
    ctx.resume();
    return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false });
}
const blackSilenceStream = () => new MediaStream([black(), silence()]);

export default function VideoMeetComponent() {

    const socketRef = useRef();
    const socketIdRef = useRef();
    const localVideoref = useRef();
    const localStreamRef = useRef(null); 
    const isScreenSharingRef = useRef(false);

    const [videoAvailable, setVideoAvailable] = useState(true);
    const [audioAvailable, setAudioAvailable] = useState(true);
    const [videoEnabled, setVideoEnabled] = useState(false); 
    const [audioEnabled, setAudioEnabled] = useState(false); 
    const [screenSharing, setScreenSharing] = useState(false); 
    const [showChatModal, setShowChatModal] = useState(false); // Initially false, or manage as needed
    const [screenAvailable, setScreenAvailable] = useState(false);
    const [messages, setMessages] = useState([]);
    const [message, setMessage] = useState("");
    const [newMessages, setNewMessages] = useState(0); 
    const [askForUsername, setAskForUsername] = useState(true);
    const [username, setUsername] = useState("");
    const [remoteVideos, setRemoteVideos] = useState([]);

    // --- Core WebRTC Functions ---

    // Function to renegotiate SDP (create offer and send signal)
    const renegotiate = useCallback(() => {
        const currentSocketId = socketIdRef.current;
        for (let id in connections) {
            if (id === currentSocketId) continue;
            const connection = connections[id];
            
            if (connection.signalingState !== 'stable') continue; 

            connection.createOffer()
                .then((description) => connection.setLocalDescription(description))
                .then(() => {
                    socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connection.localDescription }));
                })
                .catch(e => console.error("Error creating or setting offer during renegotiation:", e));
        }
    }, []);

    /**
     * Replaces tracks on all RTCPeerConnections and updates local video ref.
     * This is the heart of switching between media types (camera/screen).
     */
    const updateLocalStreamTracks = useCallback((stream, renegotiateNeeded = false) => {
        localStreamRef.current = stream;
        if (localVideoref.current) {
            localVideoref.current.srcObject = stream;
        }

        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        
        for (let id in connections) {
            const peerConnection = connections[id];

            // Replace Video Track
            const senderVideo = localSenders[id]?.video;
            if (senderVideo && videoTrack) {
                senderVideo.replaceTrack(videoTrack).catch(e => console.error("Error replacing video track:", e));
            } else if (!senderVideo && videoTrack && renegotiateNeeded) {
                // If sender doesn't exist but track does (e.g., adding video back after initial setup), add and renegotiate
                localSenders[id].video = peerConnection.addTrack(videoTrack, stream);
                renegotiate();
            }

            // Replace Audio Track
            const senderAudio = localSenders[id]?.audio;
            if (senderAudio && audioTrack) {
                senderAudio.replaceTrack(audioTrack).catch(e => console.error("Error replacing audio track:", e));
            } else if (!senderAudio && audioTrack && renegotiateNeeded) {
                 localSenders[id].audio = peerConnection.addTrack(audioTrack, stream);
                 renegotiate();
            }
        }
    }, [renegotiate]);

    // 1. Get initial permissions and media stream
    const getPermissions = useCallback(async () => {
        let videoPermission = false;
        let audioPermission = false;

        try {
            // Check for camera/mic availability (but don't necessarily keep the stream yet)
            const devices = await navigator.mediaDevices.enumerateDevices();
            videoPermission = devices.some(device => device.kind === 'videoinput');
            audioPermission = devices.some(device => device.kind === 'audioinput');
        } catch (e) {
            console.warn("Could not enumerate devices:", e);
        }

        setVideoAvailable(videoPermission);
        setAudioAvailable(audioPermission);
        setVideoEnabled(videoPermission);
        setAudioEnabled(audioPermission);

        if (navigator.mediaDevices.getDisplayMedia) {
            setScreenAvailable(true);
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: videoPermission, 
                audio: audioPermission 
            });

            // Ensure tracks are disabled if we couldn't get permission
            if (stream.getVideoTracks().length > 0) {
                stream.getVideoTracks()[0].enabled = videoPermission;
            }
            if (stream.getAudioTracks().length > 0) {
                stream.getAudioTracks()[0].enabled = audioPermission;
            }

            localStreamRef.current = stream;
            if (localVideoref.current) {
                localVideoref.current.srcObject = stream;
            }
            
        } catch (error) {
             console.error("Error getting permissions or initial media:", error);
            localStreamRef.current = blackSilenceStream();
            if (localVideoref.current) {
                localVideoref.current.srcObject = localStreamRef.current;
            }
        }
    }, []);

    useEffect(() => {
        getPermissions();
        return () => {
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
            }
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
            for (const id in connections) {
                connections[id].close();
            }
        };
    }, [getPermissions]);

    // --- Socket & Connection Logic ---

    const connectToSocketServer = useCallback(() => {
        if (socketRef.current) return;

        socketRef.current = io.connect(server_url, { secure: false });

        socketRef.current.on('signal', gotMessageFromServer);

        socketRef.current.on('connect', () => {
            socketRef.current.emit('join-call', window.location.href, username);
            socketIdRef.current = socketRef.current.id;

            socketRef.current.on('chat-message', addMessage);

            socketRef.current.on('user-left', (id) => {
                setRemoteVideos((prevVideos) => prevVideos.filter((video) => video.socketId !== id));
                if (connections[id]) {
                    connections[id].close();
                    delete connections[id];
                    delete localSenders[id];
                }
            });

            socketRef.current.on('user-joined', (id, clients) => {
                clients.forEach((socketListId) => {
                    if (socketListId === socketIdRef.current) return;
                    if (connections[socketListId]) return;

                    connections[socketListId] = new RTCPeerConnection(peerConfigConnections);
                    const connection = connections[socketListId];
                    localSenders[socketListId] = {}; // Initialize senders object for this peer
                    
                    connection.onicecandidate = function (event) {
                        if (event.candidate != null) {
                            socketRef.current.emit('signal', socketListId, JSON.stringify({ 'ice': event.candidate }));
                        }
                    }

                    // Use ontrack for modern WebRTC signaling
                    connection.ontrack = (event) => {
                        const stream = event.streams[0];
                        setRemoteVideos(prevVideos => {
                            const videoExists = prevVideos.some(video => video.socketId === socketListId);
                            if (videoExists) {
                                return prevVideos.map(video =>
                                    video.socketId === socketListId ? { ...video, stream: stream } : video
                                );
                            } else {
                                return [
                                    ...prevVideos,
                                    { socketId: socketListId, stream: stream, autoplay: true, playsinline: true }
                                ];
                            }
                        });
                    };

                    // Add local tracks to the new peer connection and save the senders
                    if (localStreamRef.current) {
                        localStreamRef.current.getTracks().forEach(track => {
                           const sender = connection.addTrack(track, localStreamRef.current);
                           if (track.kind === 'video') {
                                localSenders[socketListId].video = sender;
                           } else if (track.kind === 'audio') {
                                localSenders[socketListId].audio = sender;
                           }
                        });
                    }

                    // Create offer if we are the first client or the newly joined client needs an offer
                    if (id === socketIdRef.current) {
                        connection.createOffer()
                            .then((description) => connection.setLocalDescription(description))
                            .then(() => {
                                socketRef.current.emit('signal', socketListId, JSON.stringify({ 'sdp': connection.localDescription }));
                            })
                            .catch(e => console.error("Error creating initial offer:", e));
                    }
                });
            });
        });
    }, [renegotiate, username]);

    const gotMessageFromServer = useCallback((fromId, message) => {
        const signal = JSON.parse(message);
        if (fromId === socketIdRef.current || !connections[fromId]) return;

        const connection = connections[fromId];

        if (signal.sdp) {
            connection.setRemoteDescription(new RTCSessionDescription(signal.sdp))
                .then(() => {
                    if (signal.sdp.type === 'offer') {
                        return connection.createAnswer();
                    }
                })
                .then((description) => {
                    if (description) {
                        return connection.setLocalDescription(description);
                    }
                })
                .then(() => {
                    if (signal.sdp.type === 'offer') {
                        socketRef.current.emit('signal', fromId, JSON.stringify({ 'sdp': connection.localDescription }));
                    }
                })
                .catch(e => console.error("Error handling SDP:", e));
        }

        if (signal.ice) {
            connection.addIceCandidate(new RTCIceCandidate(signal.ice)).catch(e => console.error("Error adding ICE candidate:", e));
        }
    }, []);
    
    // --- UI/Helper Functions ---

    const addMessage = useCallback((data, sender, socketIdSender) => {
        setMessages((prevMessages) => [
            ...prevMessages,
            { sender: sender, data: data }
        ]);
        if (socketIdSender !== socketIdRef.current) {
            setNewMessages((prevNewMessages) => prevNewMessages + 1);
        }
    }, []);

    const connect = () => {
        if (username.trim() === "") {
            alert("Please enter a username.");
            return;
        }
        setAskForUsername(false);
        connectToSocketServer();
    }

    const handleVideo = async () => {
        if (!localStreamRef.current || screenSharing) return;

        const enabled = !videoEnabled;
        setVideoEnabled(enabled);
        
        // Find existing video track
        let videoTrack = localStreamRef.current.getVideoTracks()[0];
        
        if (enabled) {
            if (!videoTrack || videoTrack.isBlackPlaceholder) {
                // We need to re-acquire the camera stream, as the current track is missing or a placeholder
                try {
                    const newCameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                    videoTrack = newCameraStream.getVideoTracks()[0];

                    if (videoTrack) {
                        // Create a new stream combining new camera video with existing audio
                        const audioTrack = localStreamRef.current.getAudioTracks()[0];
                        const newStream = new MediaStream([videoTrack, audioTrack]);
                        
                        // Stop the old video track (like the black canvas track)
                        localStreamRef.current.getVideoTracks().forEach(track => track.stop());
                        
                        // Update stream and signal peers
                        updateLocalStreamTracks(newStream, true); // Renegotiate needed here
                    } else {
                        setVideoEnabled(false);
                    }
                } catch (e) {
                    console.error("Error getting camera for toggle:", e);
                    setVideoAvailable(false);
                    setVideoEnabled(false);
                }
            } else {
                // Video track exists, just enable it
                videoTrack.enabled = true;
            }
        } else {
            // Turning video OFF: Replace the camera track with a black placeholder track
            if (videoTrack) {
                videoTrack.stop(); // Stop the camera track
                const audioTrack = localStreamRef.current.getAudioTracks()[0];
                const blackTrack = black();
                blackTrack.isBlackPlaceholder = true; // Mark placeholder
                const newStream = new MediaStream([blackTrack, audioTrack]);

                updateLocalStreamTracks(newStream, false);
                renegotiate(); // Signal peers about the track change
            }
        }
    };
    
    const handleAudio = () => {
        if (!localStreamRef.current) return;
        const enabled = !audioEnabled;
        setAudioEnabled(enabled);
        
        const audioTrack = localStreamRef.current.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = enabled;
        }
    };
    
    // ⭐ SCREEN SHARE FEATURE IMPLEMENTATION ⭐
    const handleScreen = async () => {
        const currentlySharing = screenSharing;
        
        if (!currentlySharing) {
            // --- START screen share ---
            if (!screenAvailable) return;
            try {
                // Request screen media
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                isScreenSharingRef.current = true;
                setScreenSharing(true);
                
                // Stop current video tracks (camera/black placeholder)
                localStreamRef.current.getVideoTracks().forEach(track => track.stop());

                const newStreamTracks = [screenStream.getVideoTracks()[0]];
                
                // Keep the existing mic track for audio, if available
                const existingAudioTrack = localStreamRef.current.getAudioTracks()[0];
                if (existingAudioTrack) {
                    newStreamTracks.push(existingAudioTrack);
                } else if (screenStream.getAudioTracks().length > 0) {
                    // Fallback to screen audio
                    newStreamTracks.push(screenStream.getAudioTracks()[0]);
                } else {
                    newStreamTracks.push(silence());
                }

                const newStream = new MediaStream(newStreamTracks);
                
                updateLocalStreamTracks(newStream, true); // Replace tracks and renegotiate
                
                // Monitor for user stopping share via browser controls
                screenStream.getVideoTracks()[0].onended = () => {
                    if (isScreenSharingRef.current) { 
                        handleScreen(); // Automatically toggle off
                    }
                };

            } catch (e) {
                console.error("Error starting screen share:", e);
                setScreenSharing(false);
                isScreenSharingRef.current = false;
            }
        } else {
            // --- STOP screen share ---
            isScreenSharingRef.current = false;
            setScreenSharing(false);
            
            // Stop current screen stream tracks
            localStreamRef.current.getTracks().forEach(track => track.stop());

            // Get a fresh user media stream (camera/mic) based on enabled state
            try {
                const constraints = {
                    video: videoAvailable && videoEnabled, 
                    audio: audioAvailable && audioEnabled  
                };
                
                // Ensure a stream exists even if both are off, using the placeholder stream if needed
                const userMediaStream = (constraints.video || constraints.audio) 
                    ? await navigator.mediaDevices.getUserMedia(constraints) 
                    : blackSilenceStream(); 
                
                // If we got camera/mic back, ensure their enabled state matches the buttons
                if(userMediaStream.getVideoTracks().length > 0) userMediaStream.getVideoTracks()[0].enabled = videoEnabled;
                if(userMediaStream.getAudioTracks().length > 0) userMediaStream.getAudioTracks()[0].enabled = audioEnabled;
                
                updateLocalStreamTracks(userMediaStream, true); // Replace tracks and renegotiate

            } catch (e) {
                console.error("Error reverting to user media:", e);
                const defaultStream = blackSilenceStream();
                updateLocalStreamTracks(defaultStream, true);
            }
        }
    };

    const handleEndCall = () => {
        try {
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
            }
        } catch (e) { console.error(e); }
        if (socketRef.current) {
            socketRef.current.disconnect();
        }
        window.location.href = "/";
    }

    const sendMessage = () => {
        if (message.trim() === "") return;
        socketRef.current.emit('chat-message', message, username);
        addMessage(message, username, socketIdRef.current); 
        setMessage("");
    }
    
    const onEnterPress = (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    }

    const chatEndRef = useRef(null);
    useEffect(() => {
        if (chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages, showChatModal]);

    // --- Render ---

    return (
        <div>
            {askForUsername ? (
                <div style={{ padding: '20px', textAlign: 'center' }}>
                    <h2>Enter into Lobby </h2>
                    <TextField 
                        id="outlined-basic" 
                        label="Username" 
                        value={username} 
                        onChange={e => setUsername(e.target.value)} 
                        variant="outlined" 
                        onKeyDown={(e) => { if (e.key === 'Enter') connect(); }}
                        style={{ marginRight: '10px' }}
                    />
                    <Button variant="contained" onClick={connect} disabled={username.trim() === ""}>Connect</Button>
                    <div style={{ marginTop: '20px' }}>
                        <video 
                            ref={localVideoref} 
                            autoPlay 
                            muted 
                            style={{ width: '300px', border: '1px solid #ccc', borderRadius: '8px' }}
                        ></video>
                    </div>
                </div>
            ) : (
                <div className={styles.meetVideoContainer}>

                    {/* Chat Modal */}
                    {showChatModal && (
                        <div className={styles.chatRoom}>
                            <div className={styles.chatContainer}>
                                <h1>Chat</h1>
                                <div className={styles.chattingDisplay}>
                                    {messages.length !== 0 ? messages.map((item, index) => (
                                        <div style={{ marginBottom: "20px" }} key={index}>
                                            <p style={{ fontWeight: "bold" }}>{item.sender}</p>
                                            <p>{item.data}</p>
                                        </div>
                                    )) : <p>No Messages Yet</p>}
                                    <div ref={chatEndRef} />
                                </div>
                                <div className={styles.chattingArea}>
                                    <TextField 
                                        value={message} 
                                        onChange={(e) => setMessage(e.target.value)} 
                                        id="outlined-basic" 
                                        label="Enter Your chat" 
                                        variant="outlined" 
                                        onKeyDown={onEnterPress}
                                    />
                                    <Button variant='contained' onClick={sendMessage}>Send</Button>
                                </div>
                            </div>
                        </div>
                    )}


                    {/* Controls Bar */}
                    <div className={styles.buttonContainers}>
                        <IconButton onClick={handleVideo} style={{ color: "white" }} disabled={!videoAvailable || screenSharing}>
                            {videoEnabled ? <VideocamIcon /> : <VideocamOffIcon />}
                        </IconButton>

                        <IconButton onClick={handleEndCall} style={{ color: "red" }}>
                            <CallEndIcon />
                        </IconButton>

                        <IconButton onClick={handleAudio} style={{ color: "white" }} disabled={!audioAvailable}>
                            {audioEnabled ? <MicIcon /> : <MicOffIcon />}
                        </IconButton>

                        {screenAvailable && (
                            <IconButton onClick={handleScreen} style={{ color: "white" }}>
                                {screenSharing ? <StopScreenShareIcon /> : <ScreenShareIcon />}
                            </IconButton>
                        )}

                        <Badge badgeContent={newMessages} max={99} color='error'>
                            <IconButton onClick={() => { setShowChatModal(prev => !prev); if (!showChatModal) setNewMessages(0); }} style={{ color: "white" }}>
                                <ChatIcon />
                            </IconButton>
                        </Badge>
                    </div>


                    {/* Local Video Stream */}
                    <video className={styles.meetUserVideo} ref={localVideoref} autoPlay muted></video>

                    {/* Remote Video Streams */}
                    <div className={styles.conferenceView}>
                        {remoteVideos.map((video) => (
                            <div key={video.socketId} style={{ border: '2px solid blue', margin: '5px' }}>
                                <video
                                    data-socket={video.socketId}
                                    ref={ref => {
                                        if (ref && video.stream && ref.srcObject !== video.stream) {
                                            ref.srcObject = video.stream;
                                        }
                                    }}
                                    autoPlay
                                    playsInline
                                    style={{ width: '100%', height: 'auto' }}
                                >
                                </video>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}