import React from 'react';
import {createTheme,MantineProvider} from '@mantine/core';
import {Notifications} from '@mantine/notifications';

/**
 * Theme extends Mantine's native palette and component system.
 * No second design-token framework, remote fonts, or paid dependencies.
 */
const theme=createTheme({
 primaryColor:'orange',
 primaryShade:7,
 autoContrast:true,
 colors:{
  orange:['#FFF7ED','#FFEDD5','#FED7AA','#FDBA74','#FB923C','#F97316','#EA580C','#C2410C','#9A3412','#7C2D12']
 },
 fontFamily:'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
 headings:{fontFamily:'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',fontWeight:'800'},
 defaultRadius:'md',
 components:{
  Button:{defaultProps:{radius:'md'}},
  TextInput:{defaultProps:{radius:'md'}},
  NumberInput:{defaultProps:{radius:'md'}},
  Paper:{defaultProps:{radius:'lg'}},
  Card:{defaultProps:{radius:'lg'}}
 }
});

export function NexusTheme({children}){
 return <MantineProvider theme={theme} defaultColorScheme="light">
  <Notifications position="top-right" limit={3}/>
  {children}
 </MantineProvider>;
}
