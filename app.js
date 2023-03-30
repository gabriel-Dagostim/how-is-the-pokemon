//https://pokeapi.co/api/v2/pokemon/pikachu

function load(){
   



    idescolha = Math.floor(Math.random() * ((1 - 150 + 1 )* -1 ));
    let url = `https://pokeapi.co/api/v2/pokemon/${idescolha}` 

    
    fetch(url)
    .then((Response) =>{
        return Response.json();

        



    })
    
    
    
    .then((data)=> {
    
        console.clear();
        console.log(data);
        
      
    
        


    
        document.getElementById('numero').innerHTML = "N°" + data['id'];
        let img = data['sprites']['front_default'];
        document.getElementById('pic1').setAttribute('src', img);


       
        






    
    })
    
    
    
    
    .catch((erro) => {
        console.log("erro: " + erro);
    });

    
    clickbotaS()


   
    
}
   


    
    document.getElementById('botaoS').onclick = load;
    
    
    function clickbotaS(){
     
    document.getElementById("IdDivAdivinha").style.display = "block";
    document.getElementById("botaoS").style.display = "none";



    
   
    }


    function varia(){

        let idescolha = document.getElementById('numero').innerHTML

        let teste2 = (idescolha.substring(2,6))
        
        let url = `https://pokeapi.co/api/v2/pokemon/${teste2}` 

        fetch(url)
        .then((Response) =>{
            return Response.json();

        })
        
        
        
        .then((data)=> {
        
            console.clear();
            console.log(data);
            
          
        
            
        
            document.getElementById('numero').innerHTML = "N°" + data['id'];
            let img = data['sprites']['front_default'];
            document.getElementById('pic1').setAttribute('src', img);
    
                var nomepoke = data['name']

                var colocou = document.getElementById("input").value

             if(nomepoke != colocou){
                
                      
              

                

             


                var acc3 = parseInt(document.getElementById("errou").innerHTML)

            

            

                var acc4 = acc3 + 1

                var acc3 = document.getElementById("errou").innerHTML =`  ${acc4}`





                document.getElementById('pic1').style.color = 'black';




             }else{
                

                

                var acc = parseInt(document.getElementById("acertos").innerHTML)

            

            

                var acc2 = acc + 1

                var acc = document.getElementById("acertos").innerHTML =`  ${acc2}`


                load()
             }
              
    
           
    
        
        })
        
         
  
  
  
      }


    function pularAC(){



        var ppp = parseInt(document.getElementById("pulou").innerHTML)

            

            

        var aaaaa = ppp + 1

        var ppp = document.getElementById("pulou").innerHTML =`  ${aaaaa}`





load()

    }


    function gen1(num1, num2){
      


            numm01 = parseInt(num1);
            numm02 = parseInt(num2);


        blabla01 = Math.floor(Math.random() * ((numm01 - numm02 + 1 )* -1 ));


        
        let url = `https://pokeapi.co/api/v2/pokemon/${blabla01}` 

        alert(blabla)

        fetch(url)
        .then((Response) =>{
            return Response.json();
    
            
    
    
    
        })
        
        
        
        .then((data)=> {
        
            console.clear();
            console.log(data);
            
          
        
            
    
    
        
            document.getElementById('numero').innerHTML = "N°" + data['id'];
            let img = data['sprites']['front_default'];
            document.getElementById('pic1').setAttribute('src', img);
    
    
           
    })}


