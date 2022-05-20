const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { query } = require('express');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;


// middleware
app.use(cors())
app.use(express.json())


function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' });
        }
        req.decoded = decoded;
        next();
    });
}



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vmhjh.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


async function run() {
    try {
        await client.connect();
        console.log('database connected');

        const serviceCollection = client.db('doctors_portal').collection('services')
        const bookingCollection = client.db('doctors_portal').collection('bookings')
        const userCollection = client.db('doctors_portal').collection('users')
        const doctorCollection = client.db('doctors_portal').collection('doctors')
        const paymentCollection = client.db('doctors_portal').collection('payments')


        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next()
            }
            else {
                res.status(403).send({ message: 'Forbidden' });
            }
        }

        app.post('/create-payment-intent',verifyJWT, async(req, res)=>{
            const service = req.body;
            const price = service.price;
            const amount = price*100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount : amount,
                currency:'usd',
                payment_method_types:['card']
            });
            res.send({clientSecret: paymentIntent.client_secret})


        })

        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray();
            res.send(services);
        })

        app.get('/user', verifyJWT, async (req, res) => {
            // const query = {};
            // const cursor = userCollection.find(query);
            // const users = await cursor.toArray();

            const users = await userCollection.find().toArray();
            res.send(users);
        })

        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ result, token });

        })

        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });
        })

        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        })

        app.get('/available', async (req, res) => {
            const date = req.query.date;

            // setp 1: get all services
            const services = await serviceCollection.find().toArray();

            // setp 2: get the booking of that day output:[{}, {}, {}, {}, {}, {}]
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();

            // setp 3: for each service 
            services.forEach(service => {
                // step 4: find booking fo that service output:[{}, {}, {}]
                const serviceBookings = bookings.filter(b => b.treatment === service.name);
                // step 5: select slots for the service Bookings : ['', '', '', '']
                const bookedSlots = serviceBookings.map(s => s.slot);
                // step 6: select those slots that are not in bookedslots
                const available = service.slots.filter(s => !bookedSlots.includes(s));
                // step 4: set available to slots to make it easier
                service.slots = available;

                // service.booked = serviceBookings.map(s => s.slot);
            })

            res.send(services);
        })


        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient;
            const decodedEamil = req.decoded.email;
            if (patient === decodedEamil) {
                const query = { patient: patient };
                const bookings = await bookingCollection.find(query).toArray();
                // console.log(bookings)
                return res.send(bookings)
            }
            else {
                return res.status(403).send({ message: 'Forbidden access' });
            }

        })

        app.get('/booking/:id',verifyJWT, async(req, res) =>{
            const id = req.params.id;
            const query = {_id:ObjectId(id)};
            const booking = await bookingCollection.findOne(query);
            res.send(booking);

        })


        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient };
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking);
            return res.send({ success: true, result });
        })

        app.patch('/booking/:id', verifyJWT, async(req, res) =>{
            const payment = req.body;
            const id = req.params.id;
            const filter = {_id:ObjectId(id)};
            const updatedDoc ={
                $set:{
                  paid:true,
                  transactionId:payment.transactionId,

                }
            }
          
            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc);
            res.send(updatedDoc);
        })

        app.get('/doctor',verifyJWT, verifyAdmin, async(req, res) =>{
            const doctors = await doctorCollection.find().toArray();
            res.send(doctors)

        })


        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor)
            res.send(result);
        })
        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter ={email:email};
            const result = await doctorCollection.deleteOne(filter);
            res.send(result);
        })

        /**
         * API Naming Convention
         * app.get('booking')//get all booking in this collection. or get more than one or by filter
         * app.get('booking/:id')//get a specific booking
         * app.post('booking')// add a new booking
         * app.patch/put('booking/:id')//
         * app.patch('booking/:id')//update
         * app.put('booking/:id')// upsert ==>update(if exists) or insert (if dosen't exists)
         * app.delete('booking/:id')//
        */

    }
    finally {

    }

}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('doctors portal server is running')
})
app.listen(port, () => {
    console.log('server is running', port)
})