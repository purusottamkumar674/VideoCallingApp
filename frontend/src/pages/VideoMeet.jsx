import React, { useEffect, useRef, useState, useCallback } from "react";
import io from "socket.io-client";
import {
  Badge,
  IconButton,
  TextField,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import { Button } from "@mui/material";
import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import styles from "../styles/videoComponent.module.css";
import CallEndIcon from "@mui/icons-material/CallEnd";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import ChatIcon from "@mui/icons-material/Chat";
import server from "../environment";
import FilterBAndWIcon from "@mui/icons-material/FilterBAndW";
import FilterVintageIcon from "@mui/icons-material/FilterVintage";
import InvertColorsIcon from "@mui/icons-material/InvertColors";
import BlurOnIcon from "@mui/icons-material/BlurOn";
import ClearIcon from "@mui/icons-material/Clear";
import FilterIcon from "@mui/icons-material/Filter";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import StopIcon from "@mui/icons-material/Stop";
import EmojiEmotionsIcon from "@mui/icons-material/EmojiEmotions";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import PanToolIcon from "@mui/icons-material/PanTool";
import NetworkCheckIcon from "@mui/icons-material/NetworkCheck";
import WallpaperIcon from "@mui/icons-material/Wallpaper";
import PictureInPictureAltIcon from "@mui/icons-material/PictureInPictureAlt";
import PersonPinIcon from "@mui/icons-material/PersonPin";
import ClosedCaptionIcon from "@mui/icons-material/ClosedCaption";
import DrawIcon from "@mui/icons-material/Draw";
import GroupWorkIcon from "@mui/icons-material/GroupWork";
import TimerIcon from "@mui/icons-material/Timer";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import CloseIcon from "@mui/icons-material/Close";
import ImageIcon from "@mui/icons-material/Image";

const server_url = server;

const connections = {};
const localSenders = {};

const peerConfigConnections = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const black = ({ width = 640, height = 480 } = {}) => {
  let canvas = Object.assign(document.createElement("canvas"), {
    width,
    height,
  });
  canvas.getContext("2d").fillRect(0, 0, width, height);
  let stream = canvas.captureStream();
  return Object.assign(stream.getVideoTracks()[0], { enabled: false });
};

const silence = () => {
  let ctx = new AudioContext();
  let oscillator = ctx.createOscillator();
  let dst = oscillator.connect(ctx.createMediaStreamDestination());
  oscillator.start();
  ctx.resume();
  return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false });
};

const blackSilenceStream = () => new MediaStream([black(), silence()]);

export default function VideoMeetComponent() {
  const socketRef = useRef();
  const socketIdRef = useRef();
  const localVideoref = useRef();
  const localStreamRef = useRef(null);
  const isScreenSharingRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const canvasRef = useRef(null);
  const whiteboardCanvasRef = useRef(null);
  const callStartTimeRef = useRef(null);

  const [videoAvailable, setVideoAvailable] = useState(true);
  const [audioAvailable, setAudioAvailable] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [screenAvailable, setScreenAvailable] = useState(false);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [newMessages, setNewMessages] = useState(0);
  const [askForUsername, setAskForUsername] = useState(true);
  const [username, setUsername] = useState("");
  const [remoteVideos, setRemoteVideos] = useState([]);
  const [activeFilter, setActiveFilter] = useState("none");
  const [isRecording, setIsRecording] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [reactions, setReactions] = useState([]);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState([]);
  const [networkQuality, setNetworkQuality] = useState({
    quality: "good",
    bitrate: 0,
    packetLoss: 0,
  });
  const [showBackgroundMenu, setShowBackgroundMenu] = useState(false);
  const [virtualBackground, setVirtualBackground] = useState("none");
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [isPipMode, setIsPipMode] = useState(false);
  const [spotlightUser, setSpotlightUser] = useState(null);
  const [layoutMode, setLayoutMode] = useState("grid");
  const [showCaptions, setShowCaptions] = useState(false);
  const [captions, setCaptions] = useState("");
  const [recognition, setRecognition] = useState(null);
  const [showWhiteboard, setShowWhiteboard] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawColor, setDrawColor] = useState("#FF0000");
  const [showBreakoutDialog, setShowBreakoutDialog] = useState(false);
  const [breakoutRooms, setBreakoutRooms] = useState([]);
  const [currentRoom, setCurrentRoom] = useState("main");
  const [showAudioViz, setShowAudioViz] = useState(false);

  const renegotiate = useCallback(() => {
    const currentSocketId = socketIdRef.current;
    for (let id in connections) {
      if (id === currentSocketId) continue;
      const connection = connections[id];

      if (connection.signalingState !== "stable") continue;

      connection
        .createOffer()
        .then((description) => connection.setLocalDescription(description))
        .then(() => {
          socketRef.current.emit(
            "signal",
            id,
            JSON.stringify({ sdp: connection.localDescription })
          );
        })
        .catch((e) =>
          console.error(
            "Error creating or setting offer during renegotiation:",
            e
          )
        );
    }
  }, []);

  const updateLocalStreamTracks = useCallback(
    (stream, renegotiateNeeded = false) => {
      localStreamRef.current = stream;
      if (localVideoref.current) {
        localVideoref.current.srcObject = stream;
      }

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      for (let id in connections) {
        const peerConnection = connections[id];

        const senderVideo = localSenders[id]?.video;
        if (senderVideo && videoTrack) {
          senderVideo
            .replaceTrack(videoTrack)
            .catch((e) => console.error("Error replacing video track:", e));
        } else if (!senderVideo && videoTrack && renegotiateNeeded) {
          localSenders[id].video = peerConnection.addTrack(videoTrack, stream);
          renegotiate();
        }

        const senderAudio = localSenders[id]?.audio;
        if (senderAudio && audioTrack) {
          senderAudio
            .replaceTrack(audioTrack)
            .catch((e) => console.error("Error replacing audio track:", e));
        } else if (!senderAudio && audioTrack && renegotiateNeeded) {
          localSenders[id].audio = peerConnection.addTrack(audioTrack, stream);
          renegotiate();
        }
      }
    },
    [renegotiate]
  );

  const getPermissions = useCallback(async () => {
    let videoPermission = false;
    let audioPermission = false;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      videoPermission = devices.some((device) => device.kind === "videoinput");
      audioPermission = devices.some((device) => device.kind === "audioinput");
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
        audio: audioPermission,
      });

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
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      for (const id in connections) {
        connections[id].close();
      }
    };
  }, [getPermissions]);

  const connectToSocketServer = useCallback(() => {
    if (socketRef.current) return;

    socketRef.current = io.connect(server_url, { secure: false });

    socketRef.current.on("signal", gotMessageFromServer);

    socketRef.current.on("connect", () => {
      socketRef.current.emit("join-call", window.location.href, username);
      socketIdRef.current = socketRef.current.id;

      socketRef.current.on("chat-message", addMessage);

      socketRef.current.on("emoji-reaction", (reaction) => {
        setReactions((prev) => [...prev, reaction]);
        setTimeout(() => {
          setReactions((prev) => prev.filter((r) => r.id !== reaction.id));
        }, 3000);
      });

      socketRef.current.on("raise-hand", (data) => {
        setRaisedHands((prev) => {
          if (data.raised) {
            return [
              ...prev,
              { socketId: data.socketId, username: data.username },
            ];
          } else {
            return prev.filter((h) => h.socketId !== data.socketId);
          }
        });
      });

      socketRef.current.on("whiteboard-draw", (drawData) => {
        drawOnWhiteboard(drawData);
      });

      socketRef.current.on("spotlight-change", (socketId) => {
        setSpotlightUser(socketId);
      });

      socketRef.current.on("user-left", (id) => {
        setRemoteVideos((prevVideos) =>
          prevVideos.filter((video) => video.socketId !== id)
        );
        setRaisedHands((prev) => prev.filter((h) => h.socketId !== id));
        if (connections[id]) {
          connections[id].close();
          delete connections[id];
          delete localSenders[id];
        }
      });

      socketRef.current.on("user-joined", (id, clients) => {
        clients.forEach((socketListId) => {
          if (socketListId === socketIdRef.current) return;
          if (connections[socketListId]) return;

          connections[socketListId] = new RTCPeerConnection(
            peerConfigConnections
          );
          const connection = connections[socketListId];
          localSenders[socketListId] = {};

          connection.onicecandidate = function (event) {
            if (event.candidate != null) {
              socketRef.current.emit(
                "signal",
                socketListId,
                JSON.stringify({ ice: event.candidate })
              );
            }
          };

          connection.ontrack = (event) => {
            const stream = event.streams[0];
            setRemoteVideos((prevVideos) => {
              const videoExists = prevVideos.some(
                (video) => video.socketId === socketListId
              );
              if (videoExists) {
                return prevVideos.map((video) =>
                  video.socketId === socketListId
                    ? { ...video, stream: stream }
                    : video
                );
              } else {
                return [
                  ...prevVideos,
                  {
                    socketId: socketListId,
                    stream: stream,
                    autoplay: true,
                    playsinline: true,
                  },
                ];
              }
            });
          };

          if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((track) => {
              const sender = connection.addTrack(track, localStreamRef.current);
              if (track.kind === "video") {
                localSenders[socketListId].video = sender;
              } else if (track.kind === "audio") {
                localSenders[socketListId].audio = sender;
              }
            });
          }

          if (id === socketIdRef.current) {
            connection
              .createOffer()
              .then((description) =>
                connection.setLocalDescription(description)
              )
              .then(() => {
                socketRef.current.emit(
                  "signal",
                  socketListId,
                  JSON.stringify({ sdp: connection.localDescription })
                );
              })
              .catch((e) => console.error("Error creating initial offer:", e));
          }
        });
      });

      callStartTimeRef.current = Date.now();
    });
  }, [username]);

  const gotMessageFromServer = useCallback((fromId, message) => {
    const signal = JSON.parse(message);
    if (fromId === socketIdRef.current || !connections[fromId]) return;

    const connection = connections[fromId];

    if (signal.sdp) {
      connection
        .setRemoteDescription(new RTCSessionDescription(signal.sdp))
        .then(() => {
          if (signal.sdp.type === "offer") {
            return connection.createAnswer();
          }
        })
        .then((description) => {
          if (description) {
            return connection.setLocalDescription(description);
          }
        })
        .then(() => {
          if (signal.sdp.type === "offer") {
            socketRef.current.emit(
              "signal",
              fromId,
              JSON.stringify({ sdp: connection.localDescription })
            );
          }
        })
        .catch((e) => console.error("Error handling SDP:", e));
    }

    if (signal.ice) {
      connection
        .addIceCandidate(new RTCIceCandidate(signal.ice))
        .catch((e) => console.error("Error adding ICE candidate:", e));
    }
  }, []);

  const addMessage = useCallback((data, sender, socketIdSender) => {
    setMessages((prevMessages) => [
      ...prevMessages,
      { sender: sender, data: data },
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
  };

  const handleVideo = async () => {
    if (!localStreamRef.current || screenSharing) return;

    const enabled = !videoEnabled;
    setVideoEnabled(enabled);

    let videoTrack = localStreamRef.current.getVideoTracks()[0];

    if (enabled) {
      if (!videoTrack || videoTrack.isBlackPlaceholder) {
        try {
          const newCameraStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
          videoTrack = newCameraStream.getVideoTracks()[0];

          if (videoTrack) {
            const audioTrack = localStreamRef.current.getAudioTracks()[0];
            const newStream = new MediaStream([videoTrack, audioTrack]);

            localStreamRef.current
              .getVideoTracks()
              .forEach((track) => track.stop());

            updateLocalStreamTracks(newStream, true);
          } else {
            setVideoEnabled(false);
          }
        } catch (e) {
          console.error("Error getting camera for toggle:", e);
          setVideoAvailable(false);
          setVideoEnabled(false);
        }
      } else {
        videoTrack.enabled = true;
      }
    } else {
      if (videoTrack) {
        videoTrack.stop();
        const audioTrack = localStreamRef.current.getAudioTracks()[0];
        const blackTrack = black();
        blackTrack.isBlackPlaceholder = true;
        const newStream = new MediaStream([blackTrack, audioTrack]);

        updateLocalStreamTracks(newStream, false);
        renegotiate();
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

  const handleScreen = async () => {
    const currentlySharing = screenSharing;

    if (!currentlySharing) {
      if (!screenAvailable) return;
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        isScreenSharingRef.current = true;
        setScreenSharing(true);

        localStreamRef.current
          .getVideoTracks()
          .forEach((track) => track.stop());

        const newStreamTracks = [screenStream.getVideoTracks()[0]];

        const existingAudioTrack = localStreamRef.current.getAudioTracks()[0];
        if (existingAudioTrack) {
          newStreamTracks.push(existingAudioTrack);
        } else if (screenStream.getAudioTracks().length > 0) {
          newStreamTracks.push(screenStream.getAudioTracks()[0]);
        } else {
          newStreamTracks.push(silence());
        }

        const newStream = new MediaStream(newStreamTracks);

        updateLocalStreamTracks(newStream, true);

        screenStream.getVideoTracks()[0].onended = () => {
          if (isScreenSharingRef.current) {
            handleScreen();
          }
        };
      } catch (e) {
        console.error("Error starting screen share:", e);
        setScreenSharing(false);
        isScreenSharingRef.current = false;
      }
    } else {
      isScreenSharingRef.current = false;
      setScreenSharing(false);

      localStreamRef.current.getTracks().forEach((track) => track.stop());

      try {
        const constraints = {
          video: videoAvailable && videoEnabled,
          audio: audioAvailable && audioEnabled,
        };

        const userMediaStream =
          constraints.video || constraints.audio
            ? await navigator.mediaDevices.getUserMedia(constraints)
            : blackSilenceStream();

        if (userMediaStream.getVideoTracks().length > 0)
          userMediaStream.getVideoTracks()[0].enabled = videoEnabled;
        if (userMediaStream.getAudioTracks().length > 0)
          userMediaStream.getAudioTracks()[0].enabled = audioEnabled;

        updateLocalStreamTracks(userMediaStream, true);
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
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    } catch (e) {
      console.error(e);
    }

    if (isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    window.location.href = "/";
  };

  const sendMessage = () => {
    if (message.trim() === "") return;
    socketRef.current.emit("chat-message", message, username);
    addMessage(message, username, socketIdRef.current);
    setMessage("");
  };

  const onEnterPress = (e) => {
    if (e.key === "Enter") {
      sendMessage();
    }
  };

  const chatEndRef = useRef(null);
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, showChatModal]);

  useEffect(() => {
    const videoElement = localVideoref.current;
    if (videoElement) {
      switch (activeFilter) {
        case "grayscale":
          videoElement.style.filter = "grayscale(100%)";
          break;
        case "sepia":
          videoElement.style.filter = "sepia(100%)";
          break;
        case "invert":
          videoElement.style.filter = "invert(100%)";
          break;
        case "blur":
          videoElement.style.filter = "blur(5px)";
          break;
        case "brightness":
          videoElement.style.filter = "brightness(150%)";
          break;
        case "contrast":
          videoElement.style.filter = "contrast(200%)";
          break;
        case "saturate":
          videoElement.style.filter = "saturate(200%)";
          break;
        case "huerotate":
          videoElement.style.filter = "hue-rotate(90deg)";
          break;
        case "opacity":
          videoElement.style.filter = "opacity(50%)";
          break;
        default:
          videoElement.style.filter = "none";
          break;
      }
    }
  }, [activeFilter]);

  const applyFilter = (filterName) => {
    setActiveFilter((prevFilter) =>
      prevFilter === filterName ? "none" : filterName
    );
    setShowFilterMenu(false);
  };

  const startRecording = () => {
    if (!localStreamRef.current) return;

    recordedChunksRef.current = [];

    const options = {
      mimeType: "video/webm;codecs=vp9",
      videoBitsPerSecond: 2500000,
    };

    try {
      const mediaRecorder = new MediaRecorder(localStreamRef.current, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, {
          type: "video/webm",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `video-call-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        recordedChunksRef.current = [];
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      console.log("Recording started");
    } catch (error) {
      console.error("Error starting recording:", error);
      alert("Failed to start recording.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      console.log("Recording stopped");
    }
  };

  const sendEmoji = (emoji) => {
    const reaction = {
      id: Date.now() + Math.random(),
      emoji: emoji,
      socketId: socketIdRef.current,
      username: username,
    };

    setReactions((prev) => [...prev, reaction]);

    if (socketRef.current) {
      socketRef.current.emit("emoji-reaction", reaction);
    }

    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== reaction.id));
    }, 3000);

    setShowEmojiPicker(false);
  };

  const takeScreenshot = () => {
    const video = localVideoref.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `screenshot-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert("Screenshot saved!");
    });
  };

  useEffect(() => {
    if (!askForUsername && callStartTimeRef.current) {
      const interval = setInterval(() => {
        const elapsed = Math.floor(
          (Date.now() - callStartTimeRef.current) / 1000
        );
        setCallDuration(elapsed);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [askForUsername]);

  const formatDuration = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const toggleRaiseHand = () => {
    const newState = !handRaised;
    setHandRaised(newState);

    if (socketRef.current) {
      socketRef.current.emit("raise-hand", {
        socketId: socketIdRef.current,
        username: username,
        raised: newState,
      });
    }
  };

  useEffect(() => {
    if (showAudioViz && localStreamRef.current && audioEnabled) {
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(
        localStreamRef.current
      );

      analyser.fftSize = 256;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      drawAudioVisualization();
    } else {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    }
  }, [showAudioViz, audioEnabled]);

  const drawAudioVisualization = () => {
    if (!analyserRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const analyser = analyserRef.current;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!showAudioViz) return;

      requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height;

        const gradient = ctx.createLinearGradient(
          0,
          canvas.height - barHeight,
          0,
          canvas.height
        );
        gradient.addColorStop(0, "#00ff00");
        gradient.addColorStop(1, "#00aa00");

        ctx.fillStyle = gradient;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }
    };

    draw();
  };

  useEffect(() => {
    if (!askForUsername) {
      const interval = setInterval(() => {
        for (let id in connections) {
          const pc = connections[id];
          pc.getStats().then((stats) => {
            stats.forEach((report) => {
              if (report.type === "inbound-rtp" && report.kind === "video") {
                const bitrate = Math.round((report.bytesReceived * 8) / 1000);
                const packetLoss = report.packetsLost || 0;

                let quality = "excellent";
                if (bitrate < 500 || packetLoss > 10) quality = "poor";
                else if (bitrate < 1000 || packetLoss > 5) quality = "good";

                setNetworkQuality({ quality, bitrate, packetLoss });
              }
            });
          });
          break;
        }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [askForUsername]);

  const applyVirtualBackground = (bgType) => {
    setVirtualBackground(bgType);
    const video = localVideoref.current;
    if (!video) return;

    switch (bgType) {
      case "none":
        video.style.background = "transparent";
        video.style.backdropFilter = "none";
        break;
      case "blur":
        video.style.backdropFilter = "blur(10px)";
        break;
      case "office":
        video.style.background =
          "url(https://images.unsplash.com/photo-1497366216548-37526070297c?w=800) center/cover";
        break;
      case "beach":
        video.style.background =
          "url(https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800) center/cover";
        break;
      case "space":
        video.style.background =
          "url(https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=800) center/cover";
        break;
      default:
        break;
    }
    setShowBackgroundMenu(false);
  };

  const togglePiP = async () => {
    const video = localVideoref.current;
    if (!video) return;

    try {
      if (!document.pictureInPictureElement) {
        await video.requestPictureInPicture();
        setIsPipMode(true);
      } else {
        await document.exitPictureInPicture();
        setIsPipMode(false);
      }
    } catch (error) {
      console.error("PiP error:", error);
      alert("Picture-in-Picture not supported in your browser");
    }
  };

  const toggleSpotlight = (socketId) => {
    if (spotlightUser === socketId) {
      setSpotlightUser(null);
      setLayoutMode("grid");
    } else {
      setSpotlightUser(socketId);
      setLayoutMode("spotlight");
      if (socketRef.current) {
        socketRef.current.emit("spotlight-change", socketId);
      }
    }
  };

  const toggleCaptions = () => {
    if (!showCaptions) {
      if (
        "webkitSpeechRecognition" in window ||
        "SpeechRecognition" in window
      ) {
        const SpeechRecognition =
          window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognitionInstance = new SpeechRecognition();

        recognitionInstance.continuous = true;
        recognitionInstance.interimResults = true;
        recognitionInstance.lang = "en-US";

        recognitionInstance.onresult = (event) => {
          let transcript = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          setCaptions(transcript);
        };

        recognitionInstance.onerror = (event) => {
          console.error("Speech recognition error:", event.error);
        };

        recognitionInstance.start();
        setRecognition(recognitionInstance);
        setShowCaptions(true);
      } else {
        alert("Speech recognition not supported in your browser");
      }
    } else {
      if (recognition) {
        recognition.stop();
      }
      setShowCaptions(false);
      setCaptions("");
    }
  };

  const startDrawing = (e) => {
    setIsDrawing(true);
    const canvas = whiteboardCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e) => {
    if (!isDrawing) return;

    const canvas = whiteboardCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ctx = canvas.getContext("2d");
    ctx.lineTo(x, y);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    if (socketRef.current) {
      socketRef.current.emit("whiteboard-draw", { x, y, color: drawColor });
    }
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const drawOnWhiteboard = (data) => {
    const canvas = whiteboardCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    ctx.lineTo(data.x, data.y);
    ctx.strokeStyle = data.color;
    ctx.lineWidth = 3;
    ctx.stroke();
  };

  const clearWhiteboard = () => {
    const canvas = whiteboardCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const createBreakoutRooms = (numRooms) => {
    const rooms = [];
    const allUsers = [
      { socketId: socketIdRef.current, username: username },
      ...remoteVideos.map((v) => ({
        socketId: v.socketId,
        username: `User ${v.socketId.substring(0, 4)}`,
      })),
    ];

    for (let i = 0; i < numRooms; i++) {
      rooms.push({
        id: `room-${i + 1}`,
        name: `Room ${i + 1}`,
        participants: [],
      });
    }

    allUsers.forEach((user, index) => {
      rooms[index % numRooms].participants.push(user);
    });

    setBreakoutRooms(rooms);
    setShowBreakoutDialog(false);
    alert(`Created ${numRooms} breakout rooms!`);
  };

  const handleMoreClick = (event) => {
    setAnchorEl(event.currentTarget);
    setShowMoreMenu(true);
  };

  const handleMoreClose = () => {
    setAnchorEl(null);
    setShowMoreMenu(false);
  };

  return (
    <div>
      {askForUsername ? (
        <div style={{ padding: "20px", textAlign: "center" }}>
          <h2>Enter into Lobby</h2>
          <TextField
            id="outlined-basic"
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            variant="outlined"
            onKeyDown={(e) => {
              if (e.key === "Enter") connect();
            }}
            style={{ marginRight: "10px" }}
          />
          <Button
            variant="contained"
            onClick={connect}
            disabled={username.trim() === ""}
          >
            Connect
          </Button>
          <div style={{ marginTop: "20px" }}>
            <video
              ref={localVideoref}
              autoPlay
              muted
              style={{
                width: "300px",
                border: "1px solid #ccc",
                borderRadius: "8px",
              }}
            ></video>
          </div>
        </div>
      ) : (
        <div className={styles.meetVideoContainer}>
          <div
            style={{
              position: "absolute",
              top: "20px",
              left: "20px",
              background: "rgba(0, 0, 0, 0.7)",
              color: "white",
              padding: "10px 20px",
              borderRadius: "20px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              zIndex: 1000,
            }}
          >
            <TimerIcon />
            <span style={{ fontSize: "18px", fontWeight: "bold" }}>
              {formatDuration(callDuration)}
            </span>
            {isRecording && (
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  background: "red",
                  borderRadius: "50%",
                  animation: "blink 1s infinite",
                }}
              ></span>
            )}
          </div>

          <div
            style={{
              position: "absolute",
              top: "20px",
              right: "20px",
              background: "rgba(0, 0, 0, 0.7)",
              color: "white",
              padding: "10px 15px",
              borderRadius: "20px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              zIndex: 1000,
            }}
          >
            <NetworkCheckIcon
              style={{
                color:
                  networkQuality.quality === "excellent"
                    ? "#4CAF50"
                    : networkQuality.quality === "good"
                    ? "#FFC107"
                    : "#F44336",
              }}
            />
            <span>
              {networkQuality.quality === "excellent"
                ? "Excellent"
                : networkQuality.quality === "good"
                ? "Good"
                : "Poor"}
            </span>
          </div>

          {raisedHands.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "80px",
                right: "20px",
                background: "rgba(255, 193, 7, 0.9)",
                color: "black",
                padding: "10px 15px",
                borderRadius: "10px",
                zIndex: 1000,
                maxWidth: "200px",
              }}
            >
              <strong>✋ Raised Hands:</strong>
              {raisedHands.map((hand, idx) => (
                <div key={idx}>{hand.username}</div>
              ))}
            </div>
          )}

          {showCaptions && (
            <div
              style={{
                position: "absolute",
                bottom: "150px",
                left: "50%",
                transform: "translateX(-50%)",
                background: "rgba(0, 0, 0, 0.8)",
                color: "white",
                padding: "15px 25px",
                borderRadius: "10px",
                maxWidth: "80%",
                zIndex: 1000,
                fontSize: "18px",
                textAlign: "center",
              }}
            >
              {captions || "Listening..."}
            </div>
          )}

          {showAudioViz && (
            <canvas
              ref={canvasRef}
              width={300}
              height={100}
              style={{
                position: "absolute",
                bottom: "150px",
                right: "20px",
                border: "2px solid white",
                borderRadius: "10px",
                background: "rgba(0, 0, 0, 0.5)",
                zIndex: 1000,
              }}
            />
          )}

          <div
            style={{
              position: "absolute",
              bottom: "120px",
              right: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              zIndex: 1000,
              pointerEvents: "none",
            }}
          >
            {reactions.map((reaction) => (
              <div
                key={reaction.id}
                style={{
                  fontSize: "48px",
                  animation: "floatUp 3s ease-out forwards",
                  textShadow: "2px 2px 4px rgba(0,0,0,0.5)",
                }}
              >
                {reaction.emoji}
              </div>
            ))}
          </div>

          {showEmojiPicker && (
            <div
              style={{
                position: "absolute",
                bottom: "100px",
                right: "20px",
                background: "white",
                padding: "15px",
                borderRadius: "10px",
                boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
                zIndex: 1000,
                display: "flex",
                gap: "10px",
              }}
            >
              <IconButton
                onClick={() => sendEmoji("👍")}
                style={{ fontSize: "32px" }}
              >
                👍
              </IconButton>
              <IconButton
                onClick={() => sendEmoji("❤️")}
                style={{ fontSize: "32px" }}
              >
                ❤️
              </IconButton>
              <IconButton
                onClick={() => sendEmoji("😂")}
                style={{ fontSize: "32px" }}
              >
                😂
              </IconButton>
              <IconButton
                onClick={() => sendEmoji("🎉")}
                style={{ fontSize: "32px" }}
              >
                🎉
              </IconButton>
              <IconButton
                onClick={() => sendEmoji("👏")}
                style={{ fontSize: "32px" }}
              >
                👏
              </IconButton>
              <IconButton onClick={() => setShowEmojiPicker(false)}>
                <ClearIcon />
              </IconButton>
            </div>
          )}

          {showWhiteboard && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                background: "white",
                padding: "20px",
                borderRadius: "15px",
                zIndex: 1001,
                boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "10px",
                }}
              >
                <h3>Whiteboard</h3>
                <IconButton onClick={() => setShowWhiteboard(false)}>
                  <CloseIcon />
                </IconButton>
              </div>
              <div
                style={{ marginBottom: "10px", display: "flex", gap: "10px" }}
              >
                <input
                  type="color"
                  value={drawColor}
                  onChange={(e) => setDrawColor(e.target.value)}
                  style={{ width: "50px", height: "40px" }}
                />
                <Button variant="outlined" onClick={clearWhiteboard}>
                  Clear
                </Button>
              </div>
              <canvas
                ref={whiteboardCanvasRef}
                width={800}
                height={600}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                style={{
                  border: "2px solid #ccc",
                  cursor: "crosshair",
                  background: "white",
                }}
              />
            </div>
          )}

          <Dialog
            open={showBreakoutDialog}
            onClose={() => setShowBreakoutDialog(false)}
          >
            <DialogTitle>Create Breakout Rooms</DialogTitle>
            <DialogContent>
              <p>Select number of breakout rooms:</p>
              <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                <Button
                  variant="contained"
                  onClick={() => createBreakoutRooms(2)}
                >
                  2 Rooms
                </Button>
                <Button
                  variant="contained"
                  onClick={() => createBreakoutRooms(3)}
                >
                  3 Rooms
                </Button>
                <Button
                  variant="contained"
                  onClick={() => createBreakoutRooms(4)}
                >
                  4 Rooms
                </Button>
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setShowBreakoutDialog(false)}>
                Cancel
              </Button>
            </DialogActions>
          </Dialog>

          {showChatModal && (
            <div className={styles.chatRoom}>
              <div className={styles.chatContainer}>
                <h1>Chat</h1>
                <div className={styles.chattingDisplay}>
                  {messages.length !== 0 ? (
                    messages.map((item, index) => (
                      <div style={{ marginBottom: "20px" }} key={index}>
                        <p style={{ fontWeight: "bold" }}>{item.sender}</p>
                        <p>{item.data}</p>
                      </div>
                    ))
                  ) : (
                    <p>No Messages Yet</p>
                  )}
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
                  <Button variant="contained" onClick={sendMessage}>
                    Send
                  </Button>
                </div>
              </div>
            </div>
          )}

          <Menu
            anchorEl={anchorEl}
            open={showBackgroundMenu}
            onClose={() => setShowBackgroundMenu(false)}
          >
            <MenuItem onClick={() => applyVirtualBackground("none")}>
              <ClearIcon style={{ marginRight: "10px" }} /> No Background
            </MenuItem>
            <MenuItem onClick={() => applyVirtualBackground("blur")}>
              <BlurOnIcon style={{ marginRight: "10px" }} /> Blur Background
            </MenuItem>
            <MenuItem onClick={() => applyVirtualBackground("office")}>
              <ImageIcon style={{ marginRight: "10px" }} /> Office
            </MenuItem>
            <MenuItem onClick={() => applyVirtualBackground("beach")}>
              <ImageIcon style={{ marginRight: "10px" }} /> Beach
            </MenuItem>
            <MenuItem onClick={() => applyVirtualBackground("space")}>
              <ImageIcon style={{ marginRight: "10px" }} /> Space
            </MenuItem>
          </Menu>

          <div className={styles.buttonContainers}>
            <IconButton
              onClick={handleVideo}
              style={{ color: "white" }}
              disabled={!videoAvailable || screenSharing}
            >
              {videoEnabled ? <VideocamIcon /> : <VideocamOffIcon />}
            </IconButton>

            <IconButton onClick={handleEndCall} style={{ color: "red" }}>
              <CallEndIcon />
            </IconButton>

            <IconButton
              onClick={handleAudio}
              style={{ color: "white" }}
              disabled={!audioAvailable}
            >
              {audioEnabled ? <MicIcon /> : <MicOffIcon />}
            </IconButton>

            {screenAvailable && (
              <IconButton onClick={handleScreen} style={{ color: "white" }}>
                {screenSharing ? <StopScreenShareIcon /> : <ScreenShareIcon />}
              </IconButton>
            )}

            {/* <IconButton 
                            onClick={(e) => setShowFilterMenu(true) || setAnchorEl(e.currentTarget)} 
                            style={{ color: activeFilter !== 'none' ? '#007bff' : 'white' }} 
                            disabled={screenSharing}
                            title="Filters"
                        >


                            <FilterIcon />
                        </IconButton> */}

            <IconButton
              onClick={isRecording ? stopRecording : startRecording}
              style={{ color: isRecording ? "green" : "red" }}
              title={isRecording ? "Stop Recording" : "Start Recording"}
            >
              {isRecording ? <StopIcon /> : <FiberManualRecordIcon />}
            </IconButton>

            <IconButton
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              style={{ color: showEmojiPicker ? "#FFD700" : "white" }}
              title="Send Reaction"
            >
              <EmojiEmotionsIcon />
            </IconButton>

            <IconButton
              onClick={handleMoreClick}
              style={{ color: "white" }}
              title="More Options"
            >
              <Badge badgeContent={raisedHands.length} color="error">
                <MoreVertIcon />
              </Badge>
            </IconButton>

            <Badge badgeContent={newMessages} max={99} color="error">
              <IconButton
                onClick={() => {
                  setShowChatModal((prev) => !prev);
                  if (!showChatModal) setNewMessages(0);
                }}
                style={{ color: "white" }}
              >
                <ChatIcon />
              </IconButton>
            </Badge>
          </div>

          <Menu
            anchorEl={anchorEl}
            open={showMoreMenu}
            onClose={handleMoreClose}
            PaperProps={{
              style: {
                maxHeight: 400,
                width: "250px",
              },
            }}
          >
            <MenuItem
              onClick={() => {
                takeScreenshot();
                handleMoreClose();
              }}
            >
              <CameraAltIcon style={{ marginRight: "10px" }} />
              Take Screenshot
            </MenuItem>

            <MenuItem
              onClick={() => {
                toggleRaiseHand();
                handleMoreClose();
              }}
            >
              <PanToolIcon
                style={{
                  marginRight: "10px",
                  color: handRaised ? "#FFD700" : "inherit",
                }}
              />
              {handRaised ? "Lower Hand" : "Raise Hand"}
            </MenuItem>

            <MenuItem
              onClick={() => {
                setShowAudioViz(!showAudioViz);
                handleMoreClose();
              }}
            >
              <GraphicEqIcon style={{ marginRight: "10px" }} />
              Audio Visualization
            </MenuItem>

            <MenuItem
              onClick={() => {
                setShowBackgroundMenu(true);
                handleMoreClose();
              }}
            >
              <WallpaperIcon style={{ marginRight: "10px" }} />
              Virtual Background
            </MenuItem>

            <MenuItem
              onClick={() => {
                togglePiP();
                handleMoreClose();
              }}
            >
              <PictureInPictureAltIcon style={{ marginRight: "10px" }} />
              Picture-in-Picture
            </MenuItem>

            <MenuItem
              onClick={() => {
                setLayoutMode(layoutMode === "grid" ? "spotlight" : "grid");
                handleMoreClose();
              }}
            >
              <PersonPinIcon style={{ marginRight: "10px" }} />
              {layoutMode === "grid" ? "Spotlight Mode" : "Grid Mode"}
            </MenuItem>

            <MenuItem
              onClick={() => {
                toggleCaptions();
                handleMoreClose();
              }}
            >
              <ClosedCaptionIcon style={{ marginRight: "10px" }} />
              {showCaptions ? "Hide Captions" : "Live Captions"}
            </MenuItem>

          

            <MenuItem
              onClick={() => {
                setShowBreakoutDialog(true);
                handleMoreClose();
              }}
            >
              <GroupWorkIcon style={{ marginRight: "10px" }} />
              Breakout Rooms
            </MenuItem>
          </Menu>

          <video
            className={styles.meetUserVideo}
            ref={localVideoref}
            autoPlay
            muted
          ></video>

          <div
            className={styles.conferenceView}
            style={{
              display:
                layoutMode === "spotlight" && spotlightUser ? "none" : "grid",
            }}
          >
            {remoteVideos.map((video) => (
              <div
                key={video.socketId}
                style={{
                  border:
                    spotlightUser === video.socketId
                      ? "4px solid #FFD700"
                      : "2px solid blue",
                  margin: "5px",
                  position: "relative",
                }}
                onClick={() => toggleSpotlight(video.socketId)}
              >
                <video
                  data-socket={video.socketId}
                  ref={(ref) => {
                    if (ref && video.stream && ref.srcObject !== video.stream) {
                      ref.srcObject = video.stream;
                    }
                  }}
                  autoPlay
                  playsInline
                  style={{ width: "100%", height: "auto" }}
                ></video>
                {raisedHands.some((h) => h.socketId === video.socketId) && (
                  <div
                    style={{
                      position: "absolute",
                      top: "10px",
                      right: "10px",
                      fontSize: "30px",
                    }}
                  >
                    ✋
                  </div>
                )}
              </div>
            ))}
          </div>

          {layoutMode === "spotlight" && spotlightUser && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "80%",
                height: "80%",
                zIndex: 999,
              }}
            >
              {remoteVideos
                .filter((v) => v.socketId === spotlightUser)
                .map((video) => (
                  <div
                    key={video.socketId}
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "4px solid #FFD700",
                    }}
                  >
                    <video
                      ref={(ref) => {
                        if (
                          ref &&
                          video.stream &&
                          ref.srcObject !== video.stream
                        ) {
                          ref.srcObject = video.stream;
                        }
                      }}
                      autoPlay
                      playsInline
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                      }}
                    />
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      <style>{`
                @keyframes floatUp {
                    0% {
                        transform: translateY(0) scale(1);
                        opacity: 1;
                    }
                    50% {
                        transform: translateY(-50px) scale(1.2);
                        opacity: 0.8;
                    }
                    100% {
                        transform: translateY(-150px) scale(1.5);
                        opacity: 0;
                    }
                }
                @keyframes blink {
                    0%, 50% { opacity: 1; }
                    51%, 100% { opacity: 0; }
                }
            `}</style>
    </div>
  );
}
