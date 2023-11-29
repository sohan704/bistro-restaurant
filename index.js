const express = require('express');
const app = express();
const cors = require('cors');
var jwt = require('jsonwebtoken');
require('dotenv').config();
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

//middlewares

app.use(cors());
app.use(express.json());





const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.kjvt8fn.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();


    const userCollection = client.db('BistroDB').collection('users');
    const menuCollection = client.db('BistroDB').collection('menu');
    const reviewCollection = client.db('BistroDB').collection('reviews');
    const cartCollection = client.db('BistroDB').collection('carts');
    const paymentCollection = client.db('BistroDB').collection('payments');



    //jwt related api 

    app.post('/jwt', async (req, res) => {
      const user = req.body;

      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '9h' });

      res.send({ token });
    })



    //middlewares 
    const verifyToken = (req, res, next) => {
      console.log('inside verify token', req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: 'Forbidden Access' });
      }
      const token = req.headers.authorization.split(' ')[1];
      // if(!token){
      //   return res.status(401).send({message: 'Forbidden Access'});
      // }

      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
        if (error) {
          return res.status(401).send({ message: 'Forbidden Access' });
        }
        req.decoded = decoded;
        next();
      })

    }




    //verify admin middleware use verify admin after verify token

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: { $regex: '^' + email + '$', $options: 'i' } };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        res.status(403).send({ message: 'Forbidden access' })
      }
      next();
    }



    //user related api 

    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      // console.log(req.headers);
      const result = await userCollection.find().toArray();
      res.send(result);
    })

  


    app.get('/user/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      console.log('email is ', email);
      if (email !== req.decoded.email) {
        res.status(403).send({ message: 'unauthorized access' })
      }


      //  const query = {email: email};
      const query = { email: { $regex: '^' + email + '$', $options: 'i' } };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user.role === 'admin';
        console.log('The role is ', user.role)
      }

      console.log('user is ', user);
      res.send({ admin });
    })




    app.get('/admin-stats', verifyToken, verifyAdmin, async (req,res)=>{
       const users = await userCollection.estimatedDocumentCount();
       const menuItems = await menuCollection.estimatedDocumentCount();
       const orders = await paymentCollection.estimatedDocumentCount();
      //  const payments = await paymentCollection.find().toArray();
      //  const revenue = payments.reduce((total,payment)=> total+payment.price,0);

      const result = await paymentCollection.aggregate([
        {
          $group:{ 
            _id: null,
            totalRevenue:{
              $sum: '$price'
            }
          }
        }
      ]).toArray();

      const revenue = result.length > 0 ? result[0].totalRevenue : 0;

       res.send({users,menuItems, orders,revenue});
    })

   
    app.get('/order-stats', verifyToken, verifyAdmin, async(req,res)=>{
      const result = await paymentCollection.aggregate([
        {
          $unwind: '$menuItemIds'
        },
        {
          $lookup:{
            from:'menu',
            localField:'menuItemIds',
            foreignField: '_id',
            as:'menuItems'
          }
        },
        {
          $unwind:'$menuItems'
        },
        {
          $group:{
            _id:'$menuItems.category',
            quantity: {
              $sum: 1
            },
            revenue:{
              $sum: '$menuItems.price'
            }
          }
        },
        {
          $project:{
            _id:0,
            category: '$_id',
            quantity: '$quantity',
            revenue: '$revenue'
          }
        }
      ]).toArray()


      res.send(result);
    })






    app.post('/users', async (req, res) => {

      const user = req.body;
      const query = { email: user.email };

      const existingUser = await userCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: 'user already exists', insertedId: null })
      }
      console.log(user);
      const result = await userCollection.insertOne(user);
      res.send(result);
    });
   



    app.delete('/users/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    })

    app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }

      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    })

    //payment related api

    app.get('/payments/:email', verifyToken, async(req,res)=>{
      const userEmail = req.params.email;
      if(userEmail !== req.decoded.email){
        return res.status(403).send({message:'Forbidden access'});
      }
      const query = {email: userEmail};
      const result = await paymentCollection.find(query).toArray();
      res.send(result);

    })

    app.post('/payments', async(req,res)=>{
      const payment = req.body;
      console.log(payment);
      const paymentResult = await paymentCollection.insertOne(payment);
      console.log('Payment info', payment);
      const query = {_id: {
        $in: payment.cartIds.map(id => new ObjectId(id))
      }}
      
      const deleteResult = await cartCollection.deleteMany(query);
      res.send({paymentResult,deleteResult});
    })


    //cart related api 

    app.get('/carts', async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    })



    app.post('/carts', async (req, res) => {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);

    })



    app.delete('/carts/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    })





    //payment intent

    app.post('/create-payment-intent', async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price*100);
      console.log(amount);
      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
        payment_method_types: ['card']
      });
    
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });








    app.get('/menu', async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    })

    app.patch('/menu/:id', async(req,res)=>{
      const item = req.body;
      const id = req.params.id;
      const filter = {_id : id};
      // const filter = {_id : new ObjectId(id)};
      const updatedDoc = {
        $set : {
          name: item.name,
          category: item.category,
          price: item.price,
          recipe: item.recipe,
          image: item.image
        }
      }

      const result = await menuCollection.updateOne(filter,updatedDoc);

      if(result.modifiedCount === 0){
        const filter2 = {_id : new ObjectId(id)};
        const result2 = await menuCollection.updateOne(filter2,updatedDoc);
        res.send(result2);
      }else{
        res.send(result);
      }

      
    })

    app.get('/menu/:id', async(req,res) => {
      const id = req.params.id;
      const query = {_id: id};
      const result = await menuCollection.findOne(query);

      if(!result){
        const query2 = {_id: new ObjectId(id)};
        const result2 = await menuCollection.findOne(query2);
        res.send(result2);
      }else{
        res.send(result);
      }
      
      
    })

    app.post('/menu', verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await menuCollection.insertOne(item);
      res.send(result);
    })

    app.delete('/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
 

      // Check if the id parameter is a valid ObjectId

       const query = { _id: id };
      
      
        const result = await menuCollection.deleteOne(query);
        console.log(result);
        if(result.deletedCount === 0){
         const query2 = { _id: new ObjectId(id) };
          const result2 = await menuCollection.deleteOne(query2);
          res.send(result2);
        }else{
          res.send(result);
        }
        
     
    })

    app.get('/review', async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    })



    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);








app.get('/', (req, res) => {
  res.send('RESTAURANT IS LIVE')
})

app.listen(port, () => {
  console.log(`BISTRO BOSS IS LIVE ON ${port}`)
})