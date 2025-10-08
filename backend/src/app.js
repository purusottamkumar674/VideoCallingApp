import express from "express";
import { createServer } from "node:http";

import { Server } from "socket.io";

import mongoose from "mongoose";
import { connectToSocket } from "./controllers/socketManager.js";

import cors from "cors";
import userRoutes from "./routes/users.routes.js";

const app = express();
const server = createServer(app);
const io = connectToSocket(server);


app.set("port", (process.env.PORT || 8000))
app.use(cors());
app.use(express.json({ limit: "40kb" }));
app.use(express.urlencoded({ limit: "40kb", extended: true }));

app.use("/api/v1/users", userRoutes);

const start = async () => {
    app.set("mongo_user")
    // const connectionDb = await mongoose.connect("mongodb+srv://imdigitalashish:imdigitalashish@cluster0.cujabk4.mongodb.net/")

        

    const connectionDb = await mongoose.connect(

         "mongodb+srv://dharmsanatan467_db_user:DrKIliy40AzLWhon@cluster0.6sggen2.mongodb.net/zoomdb?retryWrites=true&w=majority&appName=Cluster0"
                 
      //  "mongodb+srv://dharmsanatan467_db_user:<DrKIliy40AzLWhon>@cluster0.6sggen2.mongodb.net/"

      //  "mongodb+srv://dharmsanatan467_db_user:DrKIliy40AzLWhon@cluster0.6sggen2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
          //  "mongodb+srv://dharmsanatan467_db_user:pksingh1@cluster0.6sggen2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
            );




    console.log(`MONGO Connected DB HOst: ${connectionDb.connection.host}`)
    server.listen(app.get("port"), () => {
        console.log("LISTENIN ON PORT 8000")
    });



}



start();