import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './Home';
import EnglishPage from './EnglishPage';
import TamilPage from './TamilPage';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path='/' element={<Home/>} />
        <Route path='/english' element={<EnglishPage/>} />
        <Route path='/tamil' element={<TamilPage/>} />
      </Routes>
    </Router>
  );
}

export default App;
