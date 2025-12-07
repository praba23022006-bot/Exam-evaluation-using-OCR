import React from 'react';
import { Link } from 'react-router-dom';
import './Home.css';

export default function Home() {
  return (
    <div className='home-wrap'>
      <div className='home-inner'>
        <h1>OCR Evaluation System</h1>
        <div className='buttons'>
          <Link to='/english'><button className='home-btn'>English Evaluation</button></Link>
          <Link to='/tamil'><button className='home-btn tamil'>Tamil Evaluation</button></Link>
        </div>
      </div>
    </div>
  );
}
